/// <reference types="bun" />
//
// The reference above is deliberate: frontend/tsconfig.json pins `types: ["node"]`
// for the browser build, so `bun run typecheck` would otherwise fail on the
// `bun:test` import. Referencing the types here keeps the runner's types local to
// this file instead of widening the app's global type surface.

/**
 * Regression tests for the viewer's dev API (`frontend/docs-api.ts`).
 *
 * Two of these endpoints had exploitable holes that were closed by hand and
 * verified once with curl. Nothing in the suite would have caught a
 * reintroduction, so the security cases here are written to FAIL against the
 * pre-fix code, not merely to pass against the current code:
 *
 *   1. `GET /api/docs/:path` served any `.mdx` on the machine (`path.join`
 *      happily collapses `../`), on an interface bound to 0.0.0.0.
 *   2. `POST /api/projects/select` accepted any path on disk, and since it
 *      JSON-parses regardless of Content-Type it is a CORS-*simple* request —
 *      no preflight, so any page in the developer's browser could repoint the
 *      viewer's docs root (which is also the cwd for git subprocesses).
 *   3. Unmatched `/api/projects/*` fell out of the handler without calling
 *      `next()` or ending the response, leaking the socket until timeout.
 *
 * Requests go over a real socket via `rawRequest` rather than `fetch`, because
 * WHATWG URL parsing collapses `../` in the path *before* the request is sent —
 * a `fetch`-based traversal test would exercise nothing. This is the equivalent
 * of `curl --path-as-is`.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { createDocsApi, findProjects, type Project } from './docs-api';

const dirs: string[] = [];
const servers: http.Server[] = [];

afterAll(async () => {
  for (const s of servers) await new Promise<void>(r => s.close(() => r()));
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// Raw HTTP client — sends the request target verbatim.
// --------------------------------------------------------------------------

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function decodeChunked(buf: Buffer): { body: Buffer; complete: boolean } {
  const out: Buffer[] = [];
  let i = 0;
  for (;;) {
    const nl = buf.indexOf('\r\n', i);
    if (nl === -1) return { body: Buffer.concat(out), complete: false };
    const size = parseInt(buf.subarray(i, nl).toString('latin1').split(';')[0], 16);
    if (!Number.isFinite(size)) return { body: Buffer.concat(out), complete: false };
    if (size === 0) return { body: Buffer.concat(out), complete: true }; // terminator
    const start = nl + 2;
    if (buf.length < start + size + 2) return { body: Buffer.concat(out), complete: false };
    out.push(buf.subarray(start, start + size));
    i = start + size + 2;
  }
}

/**
 * Parse a response only once it is FRAMED-COMPLETE (content-length satisfied, or
 * the chunked terminator seen). Completion is deliberately not inferred from the
 * socket closing: Bun's HTTP server holds the connection open after `res.end()`
 * even for `Connection: close`, so a close-delimited client would stall on every
 * request. Framing also keeps the "responds promptly" tests honest — a handler
 * that never ends produces no terminator and therefore times out.
 */
function parseWhenComplete(raw: Buffer): RawResponse | null {
  const sep = raw.indexOf('\r\n\r\n');
  if (sep === -1) return null;

  const [statusLine, ...headerLines] = raw.subarray(0, sep).toString('latin1').split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const c = line.indexOf(':');
    if (c > 0) headers[line.slice(0, c).toLowerCase()] = line.slice(c + 1).trim();
  }

  const status = Number(statusLine.split(' ')[1]);
  const rest = raw.subarray(sep + 4);

  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
    const { body, complete } = decodeChunked(rest);
    return complete ? { status, headers, body: body.toString('utf-8') } : null;
  }

  const len = headers['content-length'];
  if (len !== undefined) {
    const n = Number(len);
    if (rest.length < n) return null;
    return { status, headers, body: rest.subarray(0, n).toString('utf-8') };
  }

  // No framing at all — body runs to end of connection; caller settles on close.
  return null;
}

function rawRequest(
  port: number,
  target: string,
  opts: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<RawResponse> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const chunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(new Error(
        `no complete response for ${method} ${target} within ${timeoutMs}ms ` +
        `(socket left open — the handler never called res.end() or next())`,
      ));
    }, timeoutMs);

    socket.on('connect', () => {
      const lines = [
        `${method} ${target} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: close',
      ];
      for (const [k, v] of Object.entries(opts.headers ?? {})) lines.push(`${k}: ${v}`);
      if (opts.body !== undefined) lines.push(`Content-Length: ${Buffer.byteLength(opts.body)}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n' + (opts.body ?? ''));
    });

    const settle = (parsed: RawResponse) => {
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(parsed);
    };

    socket.on('data', d => {
      if (settled) return;
      chunks.push(d);
      const parsed = parseWhenComplete(Buffer.concat(chunks));
      if (parsed) settle(parsed);
    });

    socket.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    // Fallback for a close-delimited body (no content-length, no chunking).
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const raw = Buffer.concat(chunks);
      const sep = raw.indexOf('\r\n\r\n');
      if (sep === -1) return reject(new Error(`malformed response: ${raw.toString('latin1')}`));

      const [statusLine, ...headerLines] = raw.subarray(0, sep).toString('latin1').split('\r\n');
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const c = line.indexOf(':');
        if (c > 0) headers[line.slice(0, c).toLowerCase()] = line.slice(c + 1).trim();
      }
      resolve({
        status: Number(statusLine.split(' ')[1]),
        headers,
        body: raw.subarray(sep + 4).toString('utf-8'),
      });
    });
  });
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

/** Canary planted OUTSIDE the docs root. If it ever appears in a response body,
 *  containment failed and the endpoint is leaking arbitrary files again. */
const CANARY = 'CANARY-a3f9-outside-the-docs-root';

async function writeAt(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

function docMeta(path: string, title: string, relatedFiles: string[] = []) {
  return {
    id: `id-${path}`, path, title, tags: ['fixture'],
    relatedFiles, anchors: [], evidence: [], refs: [],
    verifiedCommit: '', verifiedAt: '', driftSuspectSince: '', driftSuspectReason: '',
    createdAt: 0, updatedAt: 0, createdBy: 'test',
  };
}

interface Fixture {
  root: string;
  /** Scan root containing the discoverable projects (alpha, beta). */
  workspace: string;
  alpha: string;
  beta: string;
  /** A project with a real `.docs` folder that is NOT in the scan root. */
  evil: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'catryna-docsapi-'));
  dirs.push(root);

  const workspace = join(root, 'workspace');
  const alpha = join(workspace, 'alpha');
  const beta = join(workspace, 'beta');
  const evil = join(root, 'evil');

  // --- alpha: the project under test -------------------------------------
  await writeAt(alpha, '.docs/_index.json', JSON.stringify({
    version: 1,
    lastUpdated: 0,
    docs: [
      docMeta('backend/coverage', 'Alpha Coverage Doc', ['src/index.ts']),
      docMeta('guides/intro', 'Alpha Intro Guide'),
    ],
  }));
  await writeAt(alpha, '.docs/backend/coverage.mdx',
    '---\ntitle: "Alpha Coverage Doc"\n---\n\n# Alpha Coverage Doc\n\nNested doc body.\n');
  await writeAt(alpha, '.docs/guides/intro.mdx',
    '---\ntitle: "Alpha Intro Guide"\n---\n\n# Alpha Intro Guide\n\nIntro body.\n');
  await writeAt(alpha, 'src/index.ts', 'export const alpha = 1;\n');
  await writeAt(alpha, 'src/untracked.ts', 'export const untracked = 2;\n');

  // Sits one level above the docs root — the exact containment boundary.
  await writeAt(alpha, 'outside-secret.mdx', `---\ntitle: "Secret"\n---\n\n${CANARY}\n`);

  // --- beta: a second DISCOVERABLE project (a legitimate select target) ---
  await writeAt(beta, '.docs/_index.json', JSON.stringify({
    version: 1, lastUpdated: 0, docs: [docMeta('beta/only', 'Beta Only Doc')],
  }));

  // --- evil: has a valid .docs, but lives outside the scan root -----------
  await writeAt(evil, '.docs/_index.json', JSON.stringify({
    version: 1, lastUpdated: 0, docs: [docMeta('evil/pwned', 'Evil Pwned Doc')],
  }));

  return { root, workspace, alpha, beta, evil };
}

async function git(dir: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'test@catryna.local']);
  await git(dir, ['config', 'user.name', 'Catryna Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'fixture']);
}

/** Mount the API on a real http server so socket-level behaviour is observable. */
async function mount(opts: { docsRoot: string; projects: () => Project[] }) {
  const api = createDocsApi({ docsRoot: opts.docsRoot, findProjects: opts.projects });

  const server = http.createServer((req, res) => {
    let i = 0;
    const next = () => {
      const mw = api.middlewares[i++];
      if (!mw) {
        res.statusCode = 404;
        res.end('no middleware matched');
        return;
      }
      mw(req, res, next);
    };
    next();
  });

  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  return { api, port, get: (t: string, o = {}) => rawRequest(port, t, o) };
}

// --------------------------------------------------------------------------
// Priority 1 — path traversal on GET /api/docs/:path
// --------------------------------------------------------------------------

describe('GET /api/docs/:path containment', () => {
  test('serves a legitimate nested doc', async () => {
    // The counterweight to every 403 below: proves the guard rejects by
    // location, not by rejecting everything with a slash in it.
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/backend/coverage');
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.path).toBe('backend/coverage');
    expect(body.raw).toContain('Nested doc body.');
    expect(body.title).toBe('Alpha Coverage Doc'); // metadata joined from _index.json
  });

  test('rejects ../ traversal to a real file outside the root, and leaks nothing', async () => {
    // The planted target genuinely EXISTS as .mdx one level above the docs
    // root. Pre-fix, `path.join` collapsed the `..` and this returned the file
    // body in `raw` with a 200 — so both assertions below are load-bearing.
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/../outside-secret');
    // Leak first: that is the actual harm, and asserting it before the status
    // code makes a regression report "the file came back" rather than "200 != 403".
    expect(res.body).not.toContain(CANARY);
    expect(res.status).toBe(403);
  });

  test('rejects deep traversal aimed off the project entirely', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/../../../../etc/whatever');
    expect(res.status).toBe(403);
  });

  test('rejects percent-encoded traversal', async () => {
    // Pins that decoding happens BEFORE the containment check. A guard that
    // resolves the still-encoded string treats `%2e%2e%2f` as one harmless
    // filename and answers 404 — indistinguishable from "no such doc" and one
    // decoding proxy away from being exploitable again.
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    for (const target of [
      '/api/docs/%2e%2e%2foutside-secret',
      '/api/docs/..%2foutside-secret',
      '/api/docs/%2e%2e/outside-secret',
    ]) {
      const res = await get(target);
      expect(res.status).toBe(403);
      expect(res.body).not.toContain(CANARY);
    }
  });

  test('a malformed percent-escape is a 400, not a crash', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/%zz');
    expect(res.status).toBe(400);
  });

  test('a query string does not become a literal path segment', async () => {
    // Pre-fix the doc path was `req.url.replace('/api/docs/', '')`, so
    // `guides/intro?x=1` looked for `guides/intro?x=1.mdx` and 404'd — the
    // viewer could not cache-bust a doc fetch.
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/guides/intro?x=1');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).path).toBe('guides/intro');

    // ...and the same for the miss path: the reported path is clean.
    const miss = await get('/api/docs/guides/nope?x=1');
    expect(miss.status).toBe(404);
    expect(JSON.parse(miss.body).path).toBe('guides/nope');
  });

  test('a fragment does not become a literal path segment', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/guides/intro#section');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).path).toBe('guides/intro');
  });

  test('404s for a doc that does not exist inside the root', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/backend/nonexistent');
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Doc not found');
  });
});

// --------------------------------------------------------------------------
// Priority 2 — POST /api/projects/select allowlist
// --------------------------------------------------------------------------

describe('POST /api/projects/select allowlist', () => {
  async function setup() {
    const fx = await makeFixture();
    const { api, port } = await mount({
      docsRoot: join(fx.alpha, '.docs'),
      projects: () => findProjects([fx.workspace]),
    });

    const req = (t: string, o: Parameters<typeof rawRequest>[2] = {}) => rawRequest(port, t, o);
    const select = (projectPath: string, headers?: Record<string, string>) =>
      req('/api/projects/select', {
        method: 'POST',
        body: JSON.stringify({ path: projectPath }),
        headers,
      });
    const servedTitles = async () => {
      const res = await req('/api/docs');
      expect(res.status).toBe(200);
      return JSON.parse(res.body).docs.map((d: { title: string }) => d.title) as string[];
    };

    return { fx, api, req, select, servedTitles };
  }

  test('a discovered project can be selected', async () => {
    // Counterweight: without this, every 403 assertion below would still pass
    // if the endpoint were simply broken for all inputs.
    const { fx, select, servedTitles } = await setup();
    expect(await servedTitles()).toContain('Alpha Coverage Doc');

    const res = await select(fx.beta);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(await servedTitles()).toEqual(['Beta Only Doc']);
  });

  test('an undiscovered path is refused and the docs root does NOT move', async () => {
    // `fx.evil` has a perfectly valid `.docs/_index.json`; the ONLY reason to
    // refuse it is that findProjects() never offered it. Pre-fix this returned
    // 200 and repointed the server — which also repoints the cwd used for git
    // subprocesses behind /api/coverage and /api/drift.
    const { fx, api, select, servedTitles } = await setup();
    const before = api.getDocsRoot();

    const res = await select(fx.evil);

    // State first: a 403 that still moved the root would be the real failure,
    // and the served index is the observable proof either way.
    expect(api.getDocsRoot()).toBe(before);
    const titles = await servedTitles();
    expect(titles).toContain('Alpha Coverage Doc');
    expect(titles).not.toContain('Evil Pwned Doc');

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Project not in the discovered set');
  });

  test('refuses a bare filesystem path with no .docs at all', async () => {
    const { fx, select, servedTitles } = await setup();
    const res = await select(fx.root);
    expect(res.status).toBe(403);
    expect(await servedTitles()).toContain('Alpha Coverage Doc');
  });

  test('refuses regardless of Content-Type — the CORS-simple case', async () => {
    // The handler JSON.parses the body whatever the Content-Type says, which is
    // precisely what made this reachable with a no-preflight cross-origin
    // fetch. The allowlist must therefore hold on the text/plain path too, not
    // only on the well-behaved application/json one the frontend sends.
    const { fx, select, servedTitles } = await setup();

    for (const headers of [
      { 'Content-Type': 'text/plain' },
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      {} as Record<string, string>,
    ]) {
      const res = await select(fx.evil, headers);
      expect(res.status).toBe(403);
      expect(await servedTitles()).toContain('Alpha Coverage Doc');
    }
  });

  test('a traversal-shaped path cannot smuggle an undiscovered project past the allowlist', async () => {
    // Built by concatenation, NOT path.join — join would collapse the `..`
    // here in the test and the handler would never see a traversal at all.
    // The point is that the allowlist compares RESOLVED paths, so dressing an
    // undiscovered project up as a walk out of a discovered one changes nothing.
    const { fx, select, servedTitles } = await setup();
    const sneaky = `${fx.workspace}/alpha/../../evil`;
    expect(sneaky).toContain('..'); // guard: the payload really is un-normalized

    const res = await select(sneaky);
    expect(res.status).toBe(403);
    expect(await servedTitles()).toContain('Alpha Coverage Doc');
  });

  test('a traversal-shaped path to a DISCOVERED project still resolves and is accepted', async () => {
    // The mirror of the test above: resolution must be applied to the input, not
    // used as an excuse to reject anything containing `..`.
    const { fx, select, servedTitles } = await setup();
    const res = await select(`${fx.workspace}/alpha/../beta`);
    expect(res.status).toBe(200);
    expect(await servedTitles()).toEqual(['Beta Only Doc']);
  });

  test('malformed JSON is a 400, and the root does not move', async () => {
    const { api, req, servedTitles } = await setup();
    const before = api.getDocsRoot();

    const res = await req('/api/projects/select', { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
    expect(api.getDocsRoot()).toBe(before);
    expect(await servedTitles()).toContain('Alpha Coverage Doc');
  });

  test('containment follows the root AFTER a switch, not the startup root', async () => {
    // The two fixes interact: `docsRoot` is mutable, so the traversal guard must
    // resolve against the CURRENT root on every request. If it captured the root
    // once at startup, then after switching to beta a caller could still walk
    // back into alpha's docs — reading a project the viewer is no longer showing.
    const { fx, req, select } = await setup();
    expect((await select(fx.beta)).status).toBe(200);

    // beta/.docs -> ../.. -> workspace -> alpha/.docs/...
    const res = await req('/api/docs/../../alpha/.docs/backend/coverage');
    expect(res.body).not.toContain('Nested doc body.');
    expect(res.status).toBe(403);

    // And the plain lookup now misses, because the root really did move.
    expect((await req('/api/docs/backend/coverage')).status).toBe(404);
  });

  test('GET /api/projects lists exactly the discovered set', async () => {
    const { req } = await setup();
    const res = await req('/api/projects');
    expect(res.status).toBe(200);

    const names = JSON.parse(res.body).projects.map((p: Project) => p.name).sort();
    expect(names).toEqual(['alpha', 'beta']); // `evil` is outside the scan root
  });
});

// --------------------------------------------------------------------------
// Priority 3 — /api/projects/* must never leak the socket
// --------------------------------------------------------------------------

describe('/api/projects/* always responds', () => {
  // Pre-fix these fell out of the if-chain without calling next() or ending the
  // response. The socket stayed open until the client gave up; a handful of
  // them exhaust the browser's per-origin connection pool and wedge the viewer.
  // `rawRequest` rejects on timeout, so a regression fails the test rather than
  // hanging the suite.
  const cases = [
    ['GET', '/api/projects/select'],  // right path, wrong method
    ['GET', '/api/projects/bogus'],
    ['POST', '/api/projects/bogus'],
    ['GET', '/api/projects/select/deeper'],
    ['DELETE', '/api/projects'],
  ] as const;

  for (const [method, target] of cases) {
    test(`${method} ${target} returns promptly`, async () => {
      const fx = await makeFixture();
      const { port } = await mount({
        docsRoot: join(fx.alpha, '.docs'),
        projects: () => findProjects([fx.workspace]),
      });

      const res = await rawRequest(port, target, { method, timeoutMs: 3000 });
      // DELETE /api/projects matches the exact-match list branch, which is fine
      // — the point is only that every one of these terminates.
      expect([200, 404]).toContain(res.status);
      expect(res.headers['content-type']).toBe('application/json');
    });
  }
});

// --------------------------------------------------------------------------
// Priority 4 — happy paths and malformed input
// --------------------------------------------------------------------------

describe('docs listing and search', () => {
  test('GET /api/docs returns the index', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).docs).toHaveLength(2);
  });

  test('GET /api/docs/search filters by title', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/docs/search?q=intro');
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.query).toBe('intro');
    expect(body.results.map((d: { path: string }) => d.path)).toEqual(['guides/intro']);
  });

  test('a malformed _index.json produces an error response, not a hang or crash', async () => {
    // The index is a cache that a human can hand-edit or a bad merge can
    // mangle. Whatever happens, the request must terminate.
    const fx = await makeFixture();
    await writeFile(join(fx.alpha, '.docs', '_index.json'), '{ this is not json');
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    for (const target of ['/api/docs', '/api/docs/search?q=x', '/api/coverage']) {
      const res = await get(target, { timeoutMs: 15_000 });
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body).error).toBeTruthy();
    }
  }, 60_000);
});

describe('trust endpoints', () => {
  test('coverage, drift and trend return well-formed JSON', async () => {
    const fx = await makeFixture();
    await initRepo(fx.alpha);
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    // The fixture has exactly two source files and anchors one of them, so
    // these are exact — a vaguer `typeof === 'number'` would not notice the
    // endpoint reporting against the wrong root (the dev server's cwd is
    // frontend/, not the project, which is the mistake this pins).
    const coverage = JSON.parse((await get('/api/coverage', { timeoutMs: 30_000 })).body);
    expect(coverage.totalModules).toBe(2);
    expect(coverage.documentedModules).toBe(1);
    expect(coverage.coveragePercent).toBe(50);
    expect(coverage.undocumented.map((u: { filePath: string }) => u.filePath))
      .toEqual(['src/untracked.ts']);

    const drift = JSON.parse((await get('/api/drift', { timeoutMs: 30_000 })).body);
    expect(drift.gitRepo).toBe(true);
    // Nothing is baselined, so the one anchored doc is unverified. `guides/intro`
    // anchors nothing and so is not driftable at all — it must be absent from the
    // keyed map rather than silently counted as clean, which would let the badge
    // claim a doc is verified when it has never been checked against anything.
    expect(drift.summary.unverified).toBe(1);
    expect(drift.docs['backend/coverage'].status).toBe('unverified');
    expect(drift.docs['guides/intro']).toBeUndefined();
    expect(drift.summary.clean).toBe(0);

    const trend = JSON.parse((await get('/api/coverage/trend?points=5', { timeoutMs: 30_000 })).body);
    expect(Array.isArray(trend.samples)).toBe(true);
    expect(trend.samples.length).toBeLessThanOrEqual(5);
  }, 60_000);

  test('a non-numeric ?points is tolerated', async () => {
    // `?points=abc` used to reach computeCoverageTrend as NaN and yield a
    // silently empty chart; the endpoint must fall back to its default instead.
    const fx = await makeFixture();
    await initRepo(fx.alpha);
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/api/coverage/trend?points=abc', { timeoutMs: 30_000 });
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.body).samples)).toBe(true);
  }, 60_000);

  test('unrelated URLs fall through to the next handler', async () => {
    const fx = await makeFixture();
    const { get } = await mount({ docsRoot: join(fx.alpha, '.docs'), projects: () => [] });

    const res = await get('/index.html');
    expect(res.status).toBe(404);
    expect(res.body).toBe('no middleware matched');
  });
});
