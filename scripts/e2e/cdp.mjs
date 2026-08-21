/**
 * Minimal CDP (Chrome DevTools Protocol) client for driving the real Obsidian
 * app over --remote-debugging-port. No npm deps: Node 24 global fetch+WebSocket.
 *
 * Library use (scenario.mjs):
 *   const cdp = await connectPage({ match: 'TestVault4-e2e' });
 *   const { ok, value, error } = await cdp.eval('app.vault.getName()');
 *   cdp.consoleLog  // captured console/log entries since connect
 *   await cdp.close();
 *
 * One-shot CLI use:
 *   node scripts/e2e/cdp.mjs --list
 *   node scripts/e2e/cdp.mjs --match TestVault4-e2e '1+1'
 *
 * The eval helper wraps every expression in an async IIFE with try/catch, so
 * expression-level throws come back as { ok:false, error } rather than CDP
 * exceptionDetails, and promises are awaited (awaitPromise + returnByValue).
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONSOLE_LOG_FILE = join(HERE, 'console.log');
const CDP_HTTP = process.env.CDP_HTTP ?? 'http://127.0.0.1:9222';

/** List page/browser targets on a CDP endpoint (default: CDP_HTTP env). */
export async function listTargets(http = CDP_HTTP) {
  const res = await fetch(`${http}/json`);
  if (!res.ok) throw new Error(`GET ${http}/json -> HTTP ${res.status}`);
  return res.json();
}

function remoteToValue(arg) {
  if (arg.value !== undefined) return arg.value;
  if (arg.description !== undefined) return arg.description;
  return arg.type;
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleLog = [];
    ws.addEventListener('message', (ev) => this.onMessage(ev));
  }

  onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else entry.resolve(msg.result);
      }
      return;
    }
    this.onEvent(msg);
  }

  onEvent(msg) {
    const { method, params } = msg;
    if (method === 'Runtime.consoleAPICalled') {
      const entry = {
        ts: new Date().toISOString(),
        source: `console:${params.type}`,
        level: params.type,
        text: (params.args ?? []).map(remoteToValue).map(String).join(' '),
      };
      this.consoleLog.push(entry);
      this.append(entry);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      const entry = {
        ts: new Date().toISOString(),
        source: 'exception',
        level: 'error',
        text: `${d.text ?? ''} ${d.exception?.description ?? ''}`.trim(),
      };
      this.consoleLog.push(entry);
      this.append(entry);
    } else if (method === 'Log.entryAdded') {
      const e = params.entry;
      const entry = {
        ts: new Date().toISOString(),
        source: e.source,
        level: e.level,
        text: `${e.text ?? ''}${e.url ? ` (${e.url}:${e.lineNumber ?? '?'})` : ''}`.trim(),
      };
      this.consoleLog.push(entry);
      this.append(entry);
    }
  }

  append(entry) {
    try {
      appendFileSync(CONSOLE_LOG_FILE, `${JSON.stringify(entry)}\n`);
    } catch {
      // best-effort log capture
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const ws = this.ws;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP call timed out: ${method}`));
        }
      }, 30_000).unref?.();
    });
  }

  /** Evaluate an expression (async, value-mapped). Never throws on expr errors. */
  async eval(expression) {
    const wrapped =
      `(async () => { try { return { ok: true, value: await (${expression}) }; }` +
      ` catch (e) { return { ok: false, error: String(e), stack: String((e && e.stack) || '') }; } })()`;
    const result = await this.send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      return {
        ok: false,
        error: `compile/runtime error: ${result.exceptionDetails.text} ${
          result.exceptionDetails.exception?.description ?? ''
        }`.trim(),
        stack: '',
      };
    }
    return result.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/**
 * Connect a CDP session to the first page target whose eval matches `match`.
 * `http` overrides the CDP endpoint (two simultaneous Obsidian instances use
 * one remote-debugging port each: pass http: 'http://127.0.0.1:9223' etc).
 */
export async function connectPage({ match, http } = {}) {
  const base = http ?? CDP_HTTP;
  const targets = (await listTargets(base)).filter((t) => t.type === 'page');
  for (const t of targets) {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`ws open failed: ${t.webSocketDebuggerUrl}`)), { once: true });
    });
    const cdp = new Cdp(ws);
    if (match === undefined) return finish(cdp, t);
    const probe = await cdp.eval('String(app && app.vault && app.vault.adapter && app.vault.adapter.basePath)');
    if (probe.ok && String(probe.value).includes(match)) return finish(cdp, t);
    cdp.close();
  }
  throw new Error(`no page target matched basePath containing ${JSON.stringify(match)}`);
}

async function finish(cdp, target) {
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.targetTitle = target.title;
  cdp.targetUrl = target.url;
  return cdp;
}

// --- one-shot CLI -----------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('cdp.mjs')) {
  const args = process.argv.slice(2);
  let match = process.env.CDP_MATCH;
  if (args[0] === '--list') {
    for (const t of await listTargets()) {
      console.log(`${t.type} | ${t.title} | ${t.url}`);
    }
    process.exit(0);
  }
  if (args[0] === '--cdp-http') {
    process.env.CDP_HTTP = args[1];
    args.splice(0, 2);
  }
  if (args[0] === '--match') {
    match = args[1];
    args.splice(0, 2);
  }
  const expr = args.join(' ');
  if (expr === '') {
    console.error('usage: cdp.mjs [--cdp-http URL] [--match substr] "<expression>" | --list');
    process.exit(2);
  }
  const cdp = await connectPage({ match, http: process.env.CDP_HTTP });
  const started = Date.now();
  const result = await cdp.eval(expr);
  console.log(JSON.stringify({ target: cdp.targetTitle, ms: Date.now() - started, ...result }, null, 2));
  cdp.close();
  process.exit(result.ok ? 0 : 1);
}
