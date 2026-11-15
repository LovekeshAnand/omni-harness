#!/usr/bin/env node
/**
 * omni-harness — OmniRoute + Codex CLI harness
 * Author: Lovekesh Anand <lovekeshanand6@gmail.com>
 *
 * Features:
 *  • Auto-starts OmniRoute if not running
 *  • Fetches live model list from OmniRoute /v1/models
 *  • Checks connected providers via /api/providers
 *  • Shows connected (✓) vs unconnected (✗) with colour coding
 *  • Arrow-key + type-to-search interactive model picker
 *  • Unconnected provider → opens the specific provider page in browser
 *  • Connected model → launches Codex CLI via omniroute launch-codex --model <id>
 *  • Terminal window title: "omni-harness"
 */

import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';

// ─── Config ──────────────────────────────────────────────────────────────────
const OMNIROUTE_BASE    = 'http://localhost:20128';
const OMNIROUTE_API_KEY = 'sk-8b30452a864710ca-27738a-dfddfe1d';
const OMNIROUTE_PASS    = 'CHANGEME';
const USER_EMAIL        = 'lovekeshanand6@gmail.com';

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  dim:          '\x1b[2m',
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
};

// ─── Set terminal title ───────────────────────────────────────────────────────
process.stdout.write('\x1b]0;omni-harness\x07');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cls() { process.stdout.write('\x1b[2J\x1b[H'); }

function banner() {
  const line = `${C.cyan}${'─'.repeat(70)}${C.reset}`;
  console.log(line);
  console.log(`${C.bold}${C.brightCyan}  ██████╗ ███╗   ███╗███╗   ██╗██╗${C.reset}`);
  console.log(`${C.bold}${C.brightCyan} ██╔═══██╗████╗ ████║████╗  ██║██║${C.reset}`);
  console.log(`${C.bold}${C.brightCyan} ██║   ██║██╔████╔██║██╔██╗ ██║██║${C.reset}`);
  console.log(`${C.bold}${C.brightCyan} ██║   ██║██║╚██╔╝██║██║╚██╗██║██║${C.reset}`);
  console.log(`${C.bold}${C.brightCyan} ╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║${C.reset}`);
  console.log(`${C.bold}${C.brightCyan}  ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝${C.reset}`);
  console.log();
  console.log(`${C.bold}${C.white}  ██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗${C.reset}`);
  console.log(`${C.bold}${C.white}  ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝${C.reset}`);
  console.log(`${C.bold}${C.white}  ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗${C.reset}`);
  console.log(`${C.bold}${C.white}  ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║${C.reset}`);
  console.log(`${C.bold}${C.white}  ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║${C.reset}`);
  console.log(`${C.bold}${C.white}  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝${C.reset}`);
  console.log();
  console.log(line);
  console.log(`  ${C.dim}User:${C.reset} ${C.yellow}${USER_EMAIL}${C.reset}  •  ${C.dim}Gateway:${C.reset} ${C.cyan}${OMNIROUTE_BASE}${C.reset}`);
  console.log(line);
  console.log();
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpGet(path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = path.startsWith('http') ? path : `${OMNIROUTE_BASE}${path}`;
    const req = http.get(url, {
      timeout: 7000,
      headers: {
        'Authorization': `Bearer ${OMNIROUTE_API_KEY}`,
        'Accept': 'application/json',
        ...extraHeaders,
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(path, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlStr = path.startsWith('http') ? path : `${OMNIROUTE_BASE}${path}`;
    const urlObj = new URL(urlStr);
    const opts = {
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port || '80'),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
      timeout: 7000,
    };
    const req = http.request(opts, (res) => {
      let resBody = '';
      res.on('data', (d) => (resBody += d));
      res.on('end', () => resolve({ status: res.statusCode, body: resBody, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── OmniRoute functions ──────────────────────────────────────────────────────
async function isServerRunning() {
  try {
    // /api/health is the correct unauthenticated health endpoint
    const res = await httpGet('/api/health');
    return res.status < 500;
  } catch {
    return false;
  }
}

async function startOmniRoute() {
  console.log(`  ${C.yellow}⏳ OmniRoute not running. Starting it...${C.reset}`);
  const child = spawn('cmd', ['/c', 'omniroute', 'serve', '--no-open'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  process.stdout.write(`  ${C.dim}Waiting for server`);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    process.stdout.write('.');
    if (await isServerRunning()) {
      process.stdout.write(` ${C.green}online!${C.reset}\n`);
      return true;
    }
  }
  process.stdout.write(` ${C.red}failed!${C.reset}\n`);
  return false;
}

/**
 * Returns a Set of connected provider IDs.
 * Uses GET /api/providers — returns array of provider connection objects.
 * Falls back to known-good defaults if the API is unavailable.
 */
async function getConnectedProviders() {
  // Hardcoded fallback (from previous DB inspection)
  const fallback = new Set(['combo', 'kiro', 'kilocode', 'openference', 'openrouter']);

  try {
    const res = await httpGet('/api/providers');
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const list = Array.isArray(data) ? data : (data.data || data.connections || []);

      if (list.length === 0) return fallback;

      const connected = new Set(['combo']); // combo is always "connected" (virtual)
      for (const p of list) {
        const pid = p.provider || p.id || '';
        // isActive=1 AND testStatus active/success means it's usable
        const active = p.isActive === 1 || p.isActive === true || p.is_active === 1;
        const status = (p.testStatus || p.test_status || '').toLowerCase();
        const ok = active && (status === 'active' || status === 'success' || status === '');
        if (pid && ok) connected.add(pid);
      }
      return connected;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

/**
 * Fetches the model list from /v1/models.
 */
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

/**
 * Opens the OmniRoute provider connection page in the browser.
 * Also logs in first so the browser session is authenticated.
 */
async function openProviderPage(providerId) {
  // Best-effort login to set auth_token cookie in OmniRoute's internal session store
  // (we can't inject it into the browser, but OmniRoute may keep user logged in)
  try {
    await httpPost('/api/auth/login', { password: OMNIROUTE_PASS });
  } catch {}

  const url = `${OMNIROUTE_BASE}/dashboard/providers/${encodeURIComponent(providerId)}`;
  console.log(`  ${C.dim}Opening:${C.reset} ${C.cyan}${url}${C.reset}`);
  try {
    execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync('powershell', ['-Command', `Start-Process '${url}'`], { stdio: 'ignore' });
    } catch {}
  }
}

/**
 * Launches Codex via omniroute launch-codex --model <modelId>.
 * The --model flag injects -c model=... into codex's -c args.
 */
function launchCodex(modelId, profile) {
  cls();
  console.log(`\n${C.green}${C.bold}  🚀 Launching Codex CLI via OmniRoute${C.reset}`);
  console.log(`  ${C.dim}Model:${C.reset}   ${C.brightCyan}${modelId}${C.reset}`);
  if (profile) console.log(`  ${C.dim}Profile:${C.reset} ${C.dim}${profile}${C.reset}`);
  console.log();

  // Build args: omniroute launch-codex [--model <id>] [--profile <name>]
  const args = ['launch-codex'];
  if (modelId) { args.push('--model', modelId); }
  if (profile)  { args.push('--profile', profile); }

  const child = spawn('cmd', ['/c', 'omniroute', ...args], {
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

// ─── Human-readable model name builder ───────────────────────────────────────

// Phrases to fix up after basic capitalisation
const REPLACEMENTS = [
  [/\bGpt\b/g,                   'GPT'],
  [/\bLlama\b/g,                 'Llama'],
  [/\bLlm\b/g,                   'LLM'],
  [/\bAi\b/g,                    'AI'],
  [/\bApi\b/g,                   'API'],
  [/\bSdk\b/g,                   'SDK'],
  [/\bUi\b/g,                    'UI'],
  [/\bUx\b/g,                    'UX'],
  [/\bNlp\b/g,                   'NLP'],
  [/\bRlhf\b/g,                  'RLHF'],
  [/\bOcr\b/g,                   'OCR'],
  [/\bTts\b/g,                   'TTS'],
  [/\bStt\b/g,                   'STT'],
  // Model sizes FIRST (before decimal): 70b → 70B, 8b → 8B, 405b → 405B
  [/\b(\d+)b\b/gi,               (_, n) => `${n}B`],
  // number dash number → decimal: 3-5 → 3.5
  [/(\d)-(\d)/g,                 '$1.$2'],
  // adjacent digit tokens → decimal: "3 5" → "3.5"
  [/(\d) (\d)/g,                 '$1.$2'],
];

/**
 * Turn a raw model ID slug into a clean display name.
 * e.g. "kiro/claude-sonnet-4-5"       → "Claude Sonnet 4.5"
 *      "openrouter/google/gemini-pro"  → "Gemini Pro"
 *      "of/gpt-4o-mini"               → "GPT-4o Mini"
 *      "auto/best"                     → "Auto / Best"
 *      "meta-llama/Llama-3.1-70b"     → "Llama 3.1 70B"
 */
function makeLabel(rawId, apiName) {
  // If the API gave us a real display name that isn't just the ID, prefer it
  if (apiName && apiName !== rawId && !apiName.includes('/')) {
    return applyReplacements(apiName);
  }

  // Strip provider prefix(es): take the LAST path segment
  // "openrouter/google/gemini-flash-1.5" → "gemini-flash-1.5"
  const slug = rawId.split('/').pop() || rawId;

  // Split on hyphens and underscores
  const parts = slug.split(/[-_]+/);

  // Capitalise each word, leave numbers as-is
  const words = parts.map(p => {
    if (!p) return '';
    if (/^\d/.test(p)) return p;          // starts with digit → keep
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  });

  let result = words.join(' ').trim();
  result = applyReplacements(result);
  return result;
}

function applyReplacements(s) {
  for (const [pattern, rep] of REPLACEMENTS) {
    s = s.replace(pattern, rep);
  }
  return s;
}

/** Friendly provider display name */
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
  };
  return MAP[owner] || (owner
    ? owner.charAt(0).toUpperCase() + owner.slice(1)
    : '?');
}

// ─── Build picker items ───────────────────────────────────────────────────────
function buildPickerItems(models, connectedProviders) {
  const seenModels = new Set();
  const items = [];

  for (const model of models) {
    const id    = (model.id || '').trim();
    const owner = (model.owned_by || '').trim();
    if (!id || seenModels.has(id)) continue;
    seenModels.add(id);

    // Determine if connected
    const isCombo     = owner === 'combo' || id.startsWith('auto/');
    const isConnected = isCombo
      || connectedProviders.has(owner)
      || id.startsWith('kr/')   // kiro prefix
      || id.startsWith('of/')   // openference prefix
      || id.startsWith('kc/');  // kilocode prefix

    // Clean human-readable model name
    const label = makeLabel(id, model.name || '');

    // Context window size
    const ctx = model.context_length
      ? `${(model.context_length / 1000).toFixed(0)}k ctx`
      : '';

    items.push({
      label,
      sublabel:  ctx ? `${id}  •  ${ctx}` : id,
      modelId:   id,
      provider:  owner,
      providerLabel: providerLabel(owner),
      connected: isConnected,
    });
  }

  // Sort: connected first, then by provider, then alpha by label
  items.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (a.provider !== b.provider)   return a.provider.localeCompare(b.provider);
    return a.label.localeCompare(b.label);
  });

  return items;
}

// ─── Interactive picker (in-place, no flicker) ───────────────────────────────
class Picker {
  constructor(items) {
    this.all        = items;
    this.filtered   = [...items];
    this.cursor     = 0;
    this.offset     = 0;
    this.query      = '';
    this.maxVisible = Math.max(10, Math.min(22, (process.stdout.rows || 40) - 18));
    this._prevLines = 0;   // how many lines the list area drew last time
    this._totalConn = items.filter(i => i.connected).length;
  }

  filter() {
    const q = this.query.toLowerCase();
    this.filtered = q
      ? this.all.filter(i =>
          i.label.toLowerCase().includes(q)
          || i.modelId.toLowerCase().includes(q)
          || i.provider.toLowerCase().includes(q)
          || (i.providerLabel || '').toLowerCase().includes(q))
      : [...this.all];
    this.cursor = 0;
    this.offset = 0;
  }

  move(dir) {
    this.cursor = Math.max(0, Math.min(this.filtered.length - 1, this.cursor + dir));
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + this.maxVisible)
      this.offset = this.cursor - this.maxVisible + 1;
  }

  // Write a single line, padding/clearing to EOL so stale chars don't linger
  _line(text = '') {
    process.stdout.write(text + '\x1b[K\n');
  }

  // Render only the dynamic list section in-place (no banner redraw)
  render() {
    // On first render we also draw the static header
    if (this._prevLines === 0) {
      cls();
      banner();
      // Hide cursor while animating
      process.stdout.write('\x1b[?25l');
    } else {
      // Move cursor back up to the top of the list section
      process.stdout.write(`\x1b[${this._prevLines}A`);
    }

    const lines = [];

    // ── Status bar ──
    if (this.query) {
      lines.push(`  ${C.dim}Search:${C.reset} ${C.yellow}${this.query}${C.reset}${C.dim}  (${this.filtered.length} / ${this.all.length})${C.reset}`);
    } else {
      lines.push(`  ${C.green}${C.bold}✓ ONLINE${C.reset}  ${C.dim}│${C.reset}  ${C.brightWhite}${this.all.length}${C.reset} ${C.dim}models${C.reset}  ${C.dim}│${C.reset}  ${C.green}${this._totalConn}${C.reset} ${C.dim}connected${C.reset}`);
    }
    lines.push(`  ${C.dim}↑↓ move  Enter select  Type to search  Esc clear  Ctrl+C quit${C.reset}`);
    lines.push(`${C.cyan}${'─'.repeat(70)}${C.reset}`);
    lines.push('');

    // ── Model rows ──
    const visible = this.filtered.slice(this.offset, this.offset + this.maxVisible);

    if (visible.length === 0) {
      lines.push(`  ${C.dim}No models match "${this.query}".${C.reset}`);
    }

    for (let i = 0; i < visible.length; i++) {
      const item   = visible[i];
      const isSel  = (this.offset + i) === this.cursor;
      const pvdr   = item.providerLabel || item.provider || '?';

      const icon = item.connected
        ? `${C.green}${C.bold}✓${C.reset}`
        : `${C.red}✗${C.reset}`;

      // Highlight query match in label
      let lbl = item.label;
      if (this.query) {
        const q   = this.query.toLowerCase();
        const idx = lbl.toLowerCase().indexOf(q);
        if (idx !== -1) {
          lbl = lbl.slice(0, idx)
              + C.yellow + C.bold + lbl.slice(idx, idx + q.length) + C.reset
              + lbl.slice(idx + q.length);
        }
      }

      if (isSel) {
        const action = item.connected
          ? `${C.dim}  → Launch Codex${C.reset}`
          : `${C.yellow}  → Connect provider${C.reset}`;
        const pvdrBadge = item.connected
          ? `${C.brightGreen}${pvdr}${C.reset}`
          : `${C.yellow}${pvdr}${C.reset}`;
        lines.push(`${C.bgBlue}${C.bold}  ${icon} ${C.brightWhite}${lbl}${C.reset}${C.bgBlue}  ${pvdrBadge}${action}${C.reset}`);
        lines.push(`${C.bgBlue}       ${C.dim}${item.sublabel || item.modelId}${C.reset}${C.bgBlue}${C.reset}`);
      } else {
        const pvdrDim = `${C.dim}${pvdr}${C.reset}`;
        lines.push(`  ${icon} ${C.bold}${lbl}${C.reset}  ${pvdrDim}`);
      }
    }

    lines.push('');

    // ── Scroll indicator ──
    const above = this.offset;
    const below = Math.max(0, this.filtered.length - this.offset - this.maxVisible);
    if (above > 0 && below > 0) {
      lines.push(`  ${C.dim}↑ ${above} above  ↓ ${below} below${C.reset}`);
    } else if (above > 0) {
      lines.push(`  ${C.dim}↑ ${above} above${C.reset}`);
    } else if (below > 0) {
      lines.push(`  ${C.dim}↓ ${below} more below${C.reset}`);
    } else {
      lines.push('');
    }

    // ── Write all lines in one shot (erase-to-EOL per line) ──
    const out = lines.map(l => l + '\x1b[K').join('\n') + '\n';
    process.stdout.write(out);

    // If this render is shorter than the last, blank out the leftover lines
    if (lines.length < this._prevLines) {
      for (let i = lines.length; i < this._prevLines; i++) {
        process.stdout.write('\x1b[K\n');
      }
      // Move back up to end of real content
      const extra = this._prevLines - lines.length;
      process.stdout.write(`\x1b[${extra}A`);
    }

    this._prevLines = lines.length;
  }

  run() {
    this.render();
    return new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const done = (val) => {
        process.stdout.write('\x1b[?25h'); // restore cursor
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onKey);
        resolve(val);
      };

      const onKey = (key) => {
        // Ctrl+C / Ctrl+D
        if (key === '\x03' || key === '\x04') {
          process.stdout.write('\x1b[?25h');
          stdin.setRawMode(false);
          stdin.pause();
          console.log(`\n${C.dim}  Goodbye!${C.reset}\n`);
          process.exit(0);
        }
        // Enter
        if (key === '\r' || key === '\n') { done(this.filtered[this.cursor] ?? null); return; }
        // Escape — clear search
        if (key === '\x1b') { this.query = ''; this.filter(); this.render(); return; }
        // Backspace
        if ((key === '\x7f' || key === '\x08') && this.query.length > 0) {
          this.query = this.query.slice(0, -1); this.filter(); this.render(); return;
        }
        // Arrow up / down
        if (key === '\x1b[A') { this.move(-1); this.render(); return; }
        if (key === '\x1b[B') { this.move(1);  this.render(); return; }
        // Page up / down
        if (key === '\x1b[5~') { this.move(-this.maxVisible); this.render(); return; }
        if (key === '\x1b[6~') { this.move(this.maxVisible);  this.render(); return; }
        // Home / End
        if (key === '\x1b[H') { this.move(-9999); this.render(); return; }
        if (key === '\x1b[F') { this.move(9999);  this.render(); return; }
        // Printable char → search
        if (key.length === 1 && key >= ' ') {
          this.query += key;
          this.filter();
          this.render();
          return;
        }
      };

      stdin.on('data', onKey);
    });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  cls();
  banner();

  // 1. Ensure OmniRoute is running
  process.stdout.write(`  ${C.dim}Checking OmniRoute...${C.reset} `);
  let running = await isServerRunning();

  if (running) {
    console.log(`${C.green}online${C.reset}`);
  } else {
    console.log(`${C.yellow}offline${C.reset}`);
    running = await startOmniRoute();
    if (!running) {
      console.log(`\n  ${C.red}✗ Could not start OmniRoute.`);
      console.log(`  Run 'omniroute serve' in another terminal, then try again.${C.reset}\n`);
      process.exit(1);
    }
  }

  // 2. Load providers + models in parallel
  process.stdout.write(`  ${C.dim}Fetching providers & models...${C.reset} `);
  const [connectedProviders, models] = await Promise.all([
    getConnectedProviders(),
    getModels(),
  ]);
  console.log(`${C.green}${models.length} models${C.reset}  (${C.green}${connectedProviders.size}${C.reset} provider${connectedProviders.size !== 1 ? 's' : ''} connected)\n`);

  if (models.length === 0) {
    console.log(`  ${C.red}No models available. Check ${OMNIROUTE_BASE}/dashboard${C.reset}\n`);
    process.exit(1);
  }

  // 3. Build + show picker
  const items   = buildPickerItems(models, connectedProviders);
  const picker  = new Picker(items);
  const selected = await picker.run();

  if (!selected) {
    console.log(`\n  ${C.dim}No selection. Goodbye!${C.reset}\n`);
    process.exit(0);
  }

  cls();
  banner();
  console.log(`  ${C.dim}Selected:${C.reset}  ${C.bold}${selected.label}${C.reset}`);
  console.log(`  ${C.dim}Provider:${C.reset}  ${C.cyan}${selected.provider || '(unknown)'}${C.reset}`);
  console.log(`  ${C.dim}Model ID:${C.reset}  ${C.dim}${selected.modelId}${C.reset}`);
  console.log();

  // 4a. Not connected → open browser
  if (!selected.connected) {
    console.log(`  ${C.yellow}⚠  Provider "${C.bold}${selected.provider}${C.reset}${C.yellow}" is not connected yet.${C.reset}`);
    console.log(`  ${C.dim}Opening the connection page in your browser...${C.reset}\n`);
    await openProviderPage(selected.provider || 'providers');
    console.log(`  ${C.green}✓ Browser opened${C.reset}`);
    console.log(`  ${C.dim}Dashboard password:${C.reset} ${C.yellow}${C.bold}CHANGEME${C.reset}`);
    console.log();
    console.log(`  After connecting, run ${C.cyan}omni-harness${C.reset} again and pick the model.`);
    console.log();
    process.exit(0);
  }

  // 4b. Connected → launch Codex
  launchCodex(selected.modelId, null);
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal: ${err.message}${C.reset}\n`);
  process.exit(1);
});
