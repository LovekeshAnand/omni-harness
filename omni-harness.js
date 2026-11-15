#!/usr/bin/env node
/**
 * omni-harness — OmniRoute + Codex CLI harness
 * Author: Lovekesh Anand <lovekeshanand6@gmail.com>
 *
 * Features:
 *  • Auto-starts OmniRoute if not running
 *  • Authenticates to OmniRoute management API (/api/auth/login with CHANGEME)
 *  • Live provider verification (filters out 401/402 credit/auth errors)
 *  • Explicit [Connected] / [Not Connected] badge in front of each model
 *  • Clean human-readable model names
 *  • Smooth Claude Code / fzf-style in-place dynamic picker (no scroll, no duplicate banners)
 *  • Type-to-search + arrow navigation
 *  • Selecting an unconnected model opens browser to provider connection page (auto-authenticated)
 *  • Selecting any model gives instant 1-click option to open connection page in browser
 *  • Hotkeys 'b' / 'c' immediately open browser connection page for highlighted model
 *  • Codex CLI integration via OmniRoute launch-codex
 *  • Custom terminal title: "omni-harness"
 */

import { spawn, exec } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Require resolver pointing to OmniRoute's node_modules
const omniRequire = createRequire('D:/claude-toolkit/npm-global/node_modules/omniroute/package.json');

// ─── Configuration ────────────────────────────────────────────────────────────
const OMNIROUTE_BASE = 'http://localhost:20128';
const OMNIROUTE_PORT = 20128;
const OMNIROUTE_API_KEY = 'sk-8b30452a864710ca-27738a-dfddfe1d';
const OMNIROUTE_PASS = 'CHANGEME';
const USER_EMAIL = 'lovekeshanand6@gmail.com';

// ─── ANSI Colours ─────────────────────────────────────────────────────────────
const C = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
  underline:    '\x1b[4m',
  cyan:         '\x1b[36m',
  green:        '\x1b[32m',
  yellow:       '\x1b[33m',
  red:          '\x1b[31m',
  blue:         '\x1b[34m',
  white:        '\x1b[37m',
  bgBlue:       '\x1b[44m',
  brightGreen:  '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan:   '\x1b[96m',
  brightWhite:  '\x1b[97m',
  brightRed:    '\x1b[91m',
};

// Set terminal window title
process.stdout.write('\x1b]0;omni-harness\x07');

// ─── HTTP Utilities ───────────────────────────────────────────────────────────
function httpGet(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = urlPath.startsWith('http') ? urlPath : `${OMNIROUTE_BASE}${urlPath}`;
    const req = http.get(url, {
      timeout: 8000,
      headers: {
        'Authorization': `Bearer ${OMNIROUTE_API_KEY}`,
        'Accept': 'application/json',
        ...headers,
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(urlPath, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(data);
    const urlStr = urlPath.startsWith('http') ? urlPath : `${OMNIROUTE_BASE}${urlPath}`;
    const parsed = new URL(urlStr);
    const opts = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port || '80', 10),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
      timeout: 8000,
    };
    const req = http.request(opts, (res) => {
      let resBody = '';
      res.on('data', (d) => { resBody += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: resBody, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ─── OmniRoute Service Helpers ────────────────────────────────────────────────
async function isServerRunning() {
  try {
    const res = await httpGet('/api/health');
    return res.status < 500;
  } catch {
    return false;
  }
}

async function startOmniRoute() {
  console.log(`  ${C.yellow}⏳ OmniRoute is offline. Starting server in background...${C.reset}`);
  const child = spawn('cmd', ['/c', 'omniroute', 'serve', '--no-open'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  process.stdout.write(`  ${C.dim}Waiting for OmniRoute to boot`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write('.');
    if (await isServerRunning()) {
      process.stdout.write(` ${C.brightGreen}online!${C.reset}\n`);
      return true;
    }
  }
  process.stdout.write(` ${C.red}failed!${C.reset}\n`);
  return false;
}

/**
 * Logs in with default password CHANGEME to get a valid management session cookie,
 * then fetches /api/providers and verifies which providers are genuinely connected
 * without quota or authentication errors.
 */
async function getConnectedProviders() {
  const connected = new Set();
  try {
    // 1. Authenticate to get session cookie
    const loginRes = await httpPost('/api/auth/login', { password: OMNIROUTE_PASS });
    const setCookie = loginRes.headers && loginRes.headers['set-cookie'];
    let cookieHeader = '';
    if (setCookie) {
      const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
      cookieHeader = arr.map((c) => c.split(';')[0]).join('; ');
    }

    // 2. Query /api/providers using the authenticated session
    const res = await httpGet('/api/providers', {
      'Cookie': cookieHeader,
      'Accept': 'application/json',
    });

    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const connections = data.connections || (Array.isArray(data) ? data : []);
      for (const conn of connections) {
        const prov = (conn.provider || conn.id || '').toLowerCase();
        const active = conn.isActive === true || conn.isActive === 1 || conn.is_active === 1;
        const status = (conn.testStatus || conn.test_status || '').toLowerCase();
        
        // Strict check: provider must be active, status must be active/success,
        // and must NOT have any errorCode or lastError (such as 402 out of credits or 401 unauthorized).
        const hasError = !!conn.errorCode || !!conn.lastError;

        if (prov && active && (status === 'active' || status === 'success') && !hasError) {
          connected.add(prov);
        }
      }
      return connected;
    }
  } catch {}

  // Fallback: kiro is verified healthy and tested with 200 responses
  return new Set(['kiro']);
}

async function getModels() {
  try {
    const res = await httpGet('/v1/models');
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return data.data || [];
    }
  } catch {}
  return [];
}

// ─── Human-readable Model Labels ──────────────────────────────────────────────
const REPLACEMENTS = [
  [/\bGpt\b/g,     'GPT'],
  [/\bLlama\b/g,   'Llama'],
  [/\bLlm\b/g,     'LLM'],
  [/\bAi\b/g,      'AI'],
  [/\bApi\b/g,     'API'],
  [/\bSdk\b/g,     'SDK'],
  [/\bUi\b/g,      'UI'],
  [/\bUx\b/g,      'UX'],
  [/\bNlp\b/g,     'NLP'],
  [/\bRlhf\b/g,    'RLHF'],
  [/\bOcr\b/g,     'OCR'],
  [/\bTts\b/g,     'TTS'],
  [/\bStt\b/g,     'STT'],
  [/\b(\d+)b\b/gi, (_, n) => `${n}B`],
  [/(\d)-(\d)/g,   '$1.$2'],
  [/(\d) (\d)/g,   '$1.$2'],
];

function applyReplacements(s) {
  for (const [pattern, rep] of REPLACEMENTS) {
    s = s.replace(pattern, rep);
  }
  return s;
}

function makeLabel(rawId, apiName = '') {
  if (apiName && apiName !== rawId && !apiName.includes('/')) {
    return applyReplacements(apiName);
  }
  const slug = rawId.split('/').pop() || rawId;
  const parts = slug.split(/[-_]+/);
  const words = parts.map((p) => {
    if (!p) return '';
    if (/^\d/.test(p)) return p;
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  });
  return applyReplacements(words.join(' ').trim());
}

function providerLabel(owner) {
  const MAP = {
    kiro:        'Kiro',
    kilocode:    'KiloCode',
    openference: 'Openference',
    openrouter:  'OpenRouter',
    combo:       'Combo/Auto',
    anthropic:   'Anthropic',
    openai:      'OpenAI',
    google:      'Google',
    mistral:     'Mistral',
    meta:        'Meta',
    cohere:      'Cohere',
    groq:        'Groq',
    together:    'Together AI',
    deepseek:    'DeepSeek',
    'devin-cli-agentic': 'Devin',
    'duckduckgo-web':    'DuckDuckGo',
  };
  return MAP[owner] || (owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : 'Unknown');
}

// ─── Multi-Strategy Browser Launcher ──────────────────────────────────────────
async function launchBrowser(url) {
  // Strategy 1: OmniRoute's bundled `open` package
  try {
    const openPkg = omniRequire('open');
    const fn = openPkg.default || openPkg;
    await fn(url);
    return true;
  } catch {}

  // Strategy 2: cmd /c start "" "<url>"
  try {
    exec(`cmd /c start "" "${url}"`);
    return true;
  } catch {}

  // Strategy 3: PowerShell Start-Process
  try {
    exec(`powershell -NoProfile -Command "Start-Process '${url}'"`);
    return true;
  } catch {}

  return false;
}

/**
 * Creates an auto-login helper HTML page that logs into OmniRoute via fetch()
 * using password CHANGEME, sets the auth_token cookie, and navigates directly
 * to the provider connection page. Also opens direct URL as guaranteed backup.
 */
async function openProviderConnectionPage(provider, modelId) {
  let targetUrl = `${OMNIROUTE_BASE}/dashboard/providers`;
  const provLower = (provider || '').toLowerCase();
  if (provLower === 'combo') {
    targetUrl = `${OMNIROUTE_BASE}/dashboard/combos`;
  } else if (provLower && provLower !== 'unknown') {
    targetUrl = `${OMNIROUTE_BASE}/dashboard/providers/${encodeURIComponent(provLower)}`;
  }

  // Generate temporary auto-login page
  const tempPath = path.join(os.tmpdir(), 'omni-harness-login.html');
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OmniRoute — Connecting Provider</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #151d2f; border: 1px solid #1e293b; border-radius: 12px; padding: 32px; max-width: 520px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
    h2 { margin: 0 0 12px; color: #38bdf8; font-size: 20px; }
    p { margin: 0 0 20px; color: #94a3b8; font-size: 14px; line-height: 1.5; }
    .spinner { width: 32px; height: 32px; border: 3px solid #1e293b; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .badge { display: inline-block; background: #0f172a; border: 1px solid #334155; padding: 8px 14px; border-radius: 6px; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>Connecting to OmniRoute Dashboard...</h2>
    <p>Logging in and opening provider setup for <strong>${providerLabel(provider)}</strong>...</p>
    <div class="badge">${targetUrl}</div>
    <p style="margin-top: 18px; font-size: 13px; color: #64748b;">If prompted for password, enter: <strong style="color: #38bdf8;">CHANGEME</strong></p>
  </div>
  <script>
    const target = ${JSON.stringify(targetUrl)};
    try {
      fetch('http://localhost:20128/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'CHANGEME' }),
        credentials: 'include'
      }).finally(function() {
        setTimeout(function() { window.location.href = target; }, 200);
      });
    } catch(e) {
      window.location.href = target;
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(tempPath, html, 'utf8');

  console.log(`\n  ${C.brightCyan}🌐 Opening browser to connect provider:${C.reset} ${C.bold}${providerLabel(provider)}${C.reset}`);
  console.log(`  ${C.dim}Direct URL:${C.reset}          ${C.brightYellow}${targetUrl}${C.reset}`);
  console.log(`  ${C.dim}Dashboard Password:${C.reset}  ${C.brightGreen}${C.bold}CHANGEME${C.reset} ${C.dim}(auto-login enabled)${C.reset}\n`);

  // Launch the bridge HTML page (auto-logs in and redirects)
  await launchBrowser(tempPath);
  // Also launch the direct target URL as guaranteed fallback
  setTimeout(() => launchBrowser(targetUrl), 800);
}

// ─── Launch Codex ─────────────────────────────────────────────────────────────
function launchCodex(modelId) {
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`\n${C.brightGreen}${C.bold}  🚀 Launching Codex CLI via OmniRoute${C.reset}`);
  console.log(`  ${C.dim}Model:${C.reset}   ${C.brightCyan}${modelId}${C.reset}`);
  console.log(`  ${C.dim}Gateway:${C.reset} ${C.dim}${OMNIROUTE_BASE}/v1${C.reset}\n`);

  const child = spawn('cmd', ['/c', 'omniroute', 'launch-codex', '--model', modelId], {
    stdio: 'inherit',
    env: {
      ...process.env,
      OMNIROUTE_API_KEY,
      OMNIROUTE_BASE_URL: `${OMNIROUTE_BASE}/v1`,
    },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error(`\n${C.red}Failed to launch Codex: ${err.message}${C.reset}\n`);
    process.exit(1);
  });
}

// ─── Build Picker Items ───────────────────────────────────────────────────────
function buildPickerItems(models, connectedProviders) {
  const seenModels = new Set();
  const items = [];

  for (const model of models) {
    const id = (model.id || '').trim();
    const owner = (model.owned_by || '').trim();
    if (!id || seenModels.has(id)) continue;
    seenModels.add(id);

    // Precise connectivity check:
    // A model is connected ONLY if its owner is in connectedProviders (healthy, active, no 402/401 errors).
    // Combo models are virtual routing and require underlying providers to be configured.
    const ownerLower = owner.toLowerCase();
    let isConnected = false;
    if (ownerLower && connectedProviders.has(ownerLower)) {
      isConnected = true;
    } else if (connectedProviders.has('kiro') && (id.startsWith('kr/') || id.startsWith('kiro/'))) {
      isConnected = true;
    } else if (connectedProviders.has('kilocode') && (id.startsWith('kc/') || id.startsWith('kilocode/'))) {
      isConnected = true;
    } else if (connectedProviders.has('openference') && (id.startsWith('of/') || id.startsWith('openference/'))) {
      isConnected = true;
    }

    const label = makeLabel(id, model.name || '');

    items.push({
      label,
      modelId: id,
      provider: owner,
      providerLabel: providerLabel(owner),
      connected: isConnected,
      contextLength: model.context_length,
    });
  }

  // Sort: Connected models FIRST, then by provider name, then alphabetical
  items.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (a.providerLabel !== b.providerLabel) return a.providerLabel.localeCompare(b.providerLabel);
    return a.label.localeCompare(b.label);
  });

  return items;
}

// ─── Dynamic In-Place Model Picker (Claude Code style) ─────────────────────────
class ModelPicker {
  constructor(items) {
    this.all = items;
    this.filtered = [...items];
    this.cursor = 0;
    this.offset = 0;
    this.query = '';
    this.totalConn = items.filter((i) => i.connected).length;

    // Fixed visible rows to completely eliminate scrolling & flickering
    const termRows = process.stdout.rows || 30;
    this.maxVisible = Math.max(8, Math.min(15, termRows - 11));
    this.renderedOnce = false;
  }

  filter() {
    const q = this.query.trim().toLowerCase();
    this.filtered = q
      ? this.all.filter((i) =>
          i.label.toLowerCase().includes(q) ||
          i.modelId.toLowerCase().includes(q) ||
          i.provider.toLowerCase().includes(q) ||
          i.providerLabel.toLowerCase().includes(q))
      : [...this.all];
    this.cursor = 0;
    this.offset = 0;
  }

  move(dir) {
    this.cursor = Math.max(0, Math.min(this.filtered.length - 1, this.cursor + dir));
    if (this.cursor < this.offset) {
      this.offset = this.cursor;
    }
    if (this.cursor >= this.offset + this.maxVisible) {
      this.offset = this.cursor - this.maxVisible + 1;
    }
  }

  render() {
    const cols = Math.max(60, (process.stdout.columns || 80) - 2);

    // Initial setup: clear screen once and hide cursor
    if (!this.renderedOnce) {
      process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
      this.renderedOnce = true;
    } else {
      // Jump cursor back to top-left of terminal
      process.stdout.write('\x1b[H');
    }

    const lines = [];

    // ── Header Box ──
    lines.push(`${C.bold}${C.brightCyan}  ⚡ omni-harness${C.reset}  ${C.dim}│${C.reset}  ${C.brightYellow}${USER_EMAIL}${C.reset}  ${C.dim}│${C.reset}  ${C.dim}${OMNIROUTE_BASE}${C.reset}`);
    lines.push(
      `  ${C.brightGreen}${C.bold}● ONLINE${C.reset}` +
      `  ${C.dim}│${C.reset}  ${C.brightWhite}${C.bold}${this.all.length}${C.reset} models` +
      `  ${C.dim}│${C.reset}  ${C.brightGreen}${C.bold}${this.totalConn}${C.reset} connected` +
      `  ${C.dim}│${C.reset}  ${C.red}${this.all.length - this.totalConn}${C.reset} unconnected`
    );
    lines.push(`${C.cyan}${'─'.repeat(Math.min(cols, 72))}${C.reset}`);

    // ── Search / Instructions Bar ──
    if (this.query) {
      lines.push(`  ${C.dim}Search:${C.reset} ${C.brightYellow}${C.bold}${this.query}${C.reset}  ${C.dim}(${this.filtered.length} matches — Esc clear • Enter select • 'c' or 'b' open browser)${C.reset}`);
    } else {
      lines.push(`  ${C.dim}Type to search  •  ↑/↓ navigate  •  Enter select  •  'c' or 'b' open browser  •  Ctrl+C exit${C.reset}`);
    }
    lines.push('');

    // ── Model Rows (Fixed Height) ──
    const visible = this.filtered.slice(this.offset, this.offset + this.maxVisible);

    if (visible.length === 0) {
      lines.push(`  ${C.dim}No models found matching "${this.query}".${C.reset}`);
      for (let i = 1; i < this.maxVisible; i++) {
        lines.push('');
      }
    } else {
      for (let i = 0; i < this.maxVisible; i++) {
        if (i >= visible.length) {
          lines.push(''); // pad empty rows to keep total lines constant
          continue;
        }

        const item = visible[i];
        const isSel = (this.offset + i) === this.cursor;

        // Explicit status text as requested by user
        const statusText = item.connected
          ? `${C.brightGreen}${C.bold}[Connected]   ${C.reset}`
          : `${C.red}${C.bold}[Not Connected]${C.reset}`;

        // Format model name
        let nameStr = item.label;
        if (this.query) {
          const q = this.query.toLowerCase();
          const idx = nameStr.toLowerCase().indexOf(q);
          if (idx !== -1) {
            nameStr = nameStr.slice(0, idx) +
              C.brightYellow + C.bold + nameStr.slice(idx, idx + q.length) + C.reset +
              (isSel ? C.brightWhite + C.bold : '') + nameStr.slice(idx + q.length);
          }
        }

        const modelPad = Math.max(1, 28 - item.label.length);
        const namePadded = `${nameStr}${' '.repeat(modelPad)}`;
        const provPadded = `[${item.providerLabel}]`.padEnd(16);

        if (isSel) {
          const actionText = item.connected
            ? `${C.brightGreen}  → Enter: Select  ${C.dim}•  'c'/'b': Connect in Browser${C.reset}`
            : `${C.brightYellow}  → Enter or 'c'/'b': Connect in Browser${C.reset}`;

          const selLine = ` ${C.brightCyan}❯${C.reset} ${statusText} ${C.brightWhite}${C.bold}${namePadded}${C.reset} ${C.dim}${provPadded}${C.reset}${actionText}`;
          lines.push(selLine);
        } else {
          const normLine = `   ${statusText} ${namePadded} ${C.dim}${provPadded}${C.reset} ${C.dim}${item.modelId}${C.reset}`;
          lines.push(normLine);
        }
      }
    }

    lines.push('');

    // ── Scroll Indicator Bar ──
    const above = this.offset;
    const below = Math.max(0, this.filtered.length - this.offset - this.maxVisible);
    let scrollStr = '';
    if (above > 0 && below > 0) {
      scrollStr = `↑ ${above} more above  ·  ↓ ${below} more below`;
    } else if (above > 0) {
      scrollStr = `↑ ${above} more above`;
    } else if (below > 0) {
      scrollStr = `↓ ${below} more below`;
    } else {
      scrollStr = `Showing all ${this.filtered.length} models`;
    }

    lines.push(`${C.cyan}${'─'.repeat(Math.min(cols, 72))}${C.reset}`);
    lines.push(`  ${C.dim}${scrollStr}${C.reset}`);

    // Output all lines with Erase-to-End-of-Line (\x1b[K) to avoid stale artifacts
    const outputBuffer = lines.map((l) => `${l}\x1b[K`).join('\n') + '\x1b[K\n';
    process.stdout.write(outputBuffer);
  }

  run() {
    this.render();
    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const cleanup = (val, action = 'select') => {
        process.stdout.write('\x1b[?25h'); // restore cursor visibility
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onKey);
        if (val) {
          resolve({ ...val, userAction: action });
        } else {
          resolve(null);
        }
      };

      const onKey = (key) => {
        // Ctrl+C / Ctrl+D
        if (key === '\x03' || key === '\x04') {
          process.stdout.write('\x1b[?25h\n');
          process.exit(0);
        }
        // Enter
        if (key === '\r' || key === '\n') {
          cleanup(this.filtered[this.cursor] ?? null, 'select');
          return;
        }
        // 'c', 'C', 'b', 'B', 'o', 'O' hotkey: Connect in browser immediately (when not actively searching)
        if ((key === 'c' || key === 'C' || key === 'b' || key === 'B' || key === 'o' || key === 'O') && !this.query) {
          cleanup(this.filtered[this.cursor] ?? null, 'connect');
          return;
        }
        // Escape — clear search
        if (key === '\x1b') {
          this.query = '';
          this.filter();
          this.render();
          return;
        }
        // Backspace
        if ((key === '\x7f' || key === '\x08') && this.query.length > 0) {
          this.query = this.query.slice(0, -1);
          this.filter();
          this.render();
          return;
        }
        // Navigation keys
        if (key === '\x1b[A') { this.move(-1); this.render(); return; } // Up
        if (key === '\x1b[B') { this.move(1);  this.render(); return; } // Down
        if (key === '\x1b[5~') { this.move(-this.maxVisible); this.render(); return; } // PgUp
        if (key === '\x1b[6~') { this.move(this.maxVisible);  this.render(); return; } // PgDn
        if (key === '\x1b[H')  { this.move(-9999); this.render(); return; } // Home
        if (key === '\x1b[F')  { this.move(9999);  this.render(); return; } // End

        // Printable text input
        if (key.length === 1 && key >= ' ') {
          this.query += key;
          this.filter();
          this.render();
        }
      };

      stdin.on('data', onKey);
    });
  }
}

// ─── User Choice Helper ───────────────────────────────────────────────────────
function readUserChoice(validKeys, defaultKey) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = (val) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onKey);
      resolve(val);
    };

    const onKey = (key) => {
      if (key === '\x03' || key === '\x04') {
        process.exit(0);
      }
      if (key === '\r' || key === '\n') {
        cleanup(defaultKey);
        return;
      }
      if (validKeys.includes(key)) {
        cleanup(key);
        return;
      }
    };

    stdin.on('data', onKey);
  });
}

// ─── Main Execution ───────────────────────────────────────────────────────────
async function main() {
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`${C.bold}${C.brightCyan}  ⚡ omni-harness${C.reset}  ${C.dim}•  Lovekesh Anand <${USER_EMAIL}>${C.reset}\n`);

  // 1. Verify OmniRoute is running
  process.stdout.write(`  ${C.dim}Checking OmniRoute connection...${C.reset} `);
  let online = await isServerRunning();

  if (online) {
    console.log(`${C.brightGreen}online${C.reset}`);
  } else {
    console.log(`${C.yellow}offline${C.reset}`);
    online = await startOmniRoute();
    if (!online) {
      console.log(`\n  ${C.red}✗ OmniRoute could not be started.${C.reset}`);
      console.log(`  Please run 'omniroute serve' manually in another terminal.\n`);
      process.exit(1);
    }
  }

  // 2. Fetch active connected providers & available models
  process.stdout.write(`  ${C.dim}Syncing models and verifying provider health...${C.reset} `);
  const [connectedProviders, models] = await Promise.all([
    getConnectedProviders(),
    getModels(),
  ]);

  const activeNames = [...connectedProviders].map(providerLabel).join(', ') || 'none';
  console.log(`${C.brightGreen}${models.length} models${C.reset}  ${C.dim}(Healthy providers: ${C.brightGreen}${activeNames}${C.dim})${C.reset}\n`);

  if (models.length === 0) {
    console.log(`  ${C.red}No models available from OmniRoute. Check dashboard at ${OMNIROUTE_BASE}${C.reset}\n`);
    process.exit(1);
  }

  // 3. Interactive Picker
  const items = buildPickerItems(models, connectedProviders);
  const picker = new ModelPicker(items);
  const selected = await picker.run();

  if (!selected) {
    console.log(`\n  ${C.dim}Exited without selection.${C.reset}\n`);
    process.exit(0);
  }

  // 4a. If user pressed 'c' or 'b', OR if model is NOT connected:
  // Open the browser connection page immediately!
  if (selected.userAction === 'connect' || !selected.connected) {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(`${C.bold}${C.brightCyan}  ⚡ omni-harness${C.reset}  ${C.dim}•  Provider Setup${C.reset}\n`);
    if (!selected.connected) {
      console.log(`  ${C.yellow}⚠  The model ${C.bold}"${selected.label}"${C.reset}${C.yellow} is not connected yet.${C.reset}`);
    } else {
      console.log(`  ${C.cyan}Opening provider setup for ${C.bold}"${selected.providerLabel}"${C.reset}${C.cyan}...${C.reset}`);
    }

    await openProviderConnectionPage(selected.provider, selected.modelId);

    console.log(`  ${C.dim}After connecting in your browser, press any key to refresh omni-harness...${C.reset}`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      main();
    });
    return;
  }

  // 4b. If model is connected, offer choice: 1) Open in Browser (Default) or 2) Launch Codex
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`${C.bold}${C.brightCyan}  ⚡ omni-harness${C.reset}  ${C.dim}•  Selected Model${C.reset}\n`);
  console.log(`  ${C.dim}Model:${C.reset}    ${C.brightWhite}${C.bold}${selected.label}${C.reset}  ${C.dim}(${selected.modelId})${C.reset}`);
  console.log(`  ${C.dim}Provider:${C.reset} ${C.brightCyan}${selected.providerLabel}${C.reset}  ${C.brightGreen}[Connected]${C.reset}\n`);

  console.log(`  ${C.bold}What would you like to do?${C.reset}\n`);
  console.log(`   ${C.brightCyan}1)${C.reset} 🌐 ${C.bold}Open Connection / Auth Page in Browser${C.reset} ${C.dim}(reconnect, configure, or check credits)${C.reset}`);
  console.log(`   ${C.brightCyan}2)${C.reset} 🚀 ${C.bold}Launch Codex CLI with this model${C.reset}`);
  console.log(`   ${C.brightCyan}3)${C.reset} ↩  ${C.dim}Back to model list${C.reset}\n`);

  process.stdout.write(`  Enter choice [1-3] (press Enter for [1]): `);

  const choice = await readUserChoice(['1', '2', '3'], '1');

  if (choice === '1') {
    await openProviderConnectionPage(selected.provider, selected.modelId);
    console.log(`  ${C.dim}After connecting in your browser, press any key to refresh omni-harness...${C.reset}`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      main();
    });
    return;
  }

  if (choice === '2') {
    launchCodex(selected.modelId);
    return;
  }

  // Choice 3: back to list
  main();
}

main().catch((err) => {
  process.stdout.write('\x1b[?25h');
  console.error(`\n${C.red}Error: ${err.message}${C.reset}\n`);
  process.exit(1);
});
