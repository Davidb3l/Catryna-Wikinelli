/**
 * The viewer's dev API, extracted from `vite.config.ts` so it can be tested
 * without booting a Vite dev server.
 *
 * These are plain connect middlewares — `(req, res, next)` — and hold `docsRoot`
 * in a closure because `POST /api/projects/select` repoints it at runtime.
 * `createDocsApi()` returns a fresh, independent instance per call, so a test
 * that flips the root cannot leak into the next one.
 *
 * The project scan roots are passed in rather than derived from `__dirname`:
 * this module is imported both by the Vite config and by the test runner, and
 * only the config knows where it lives on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Project {
  name: string;
  path: string;
  docsPath: string;
}

export type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * The directories scanned for sibling projects, in priority order.
 * `siblingRoot` is the grandparent of the viewer (i.e. where Catryna itself
 * lives alongside other checkouts).
 */
export function defaultScanRoots(siblingRoot: string): string[] {
  const scanDirs: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // 1. User-specified projects root (set PROJECTS_ROOT env var)
  if (process.env.PROJECTS_ROOT) scanDirs.push(process.env.PROJECTS_ROOT);

  // 2. Sibling projects to Catryna
  scanDirs.push(siblingRoot);

  // 3. Common project directories (cross-platform)
  if (home) {
    scanDirs.push(
      path.join(home, 'Projects'),
      path.join(home, 'projects'),
      path.join(home, 'Code'),
      path.join(home, 'code'),
      path.join(home, 'dev'),
      path.join(home, 'repos'),
      path.join(home, 'src'),
    );
  }

  return scanDirs;
}

/** Scan the given directories for projects carrying a populated `.docs` folder. */
export function findProjects(scanRoots: string[]): Project[] {
  const projects: Project[] = [];
  const seen = new Set<string>();

  for (const scanDir of scanRoots) {
    if (!fs.existsSync(scanDir)) continue;

    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = path.join(scanDir, entry.name);
        const docsPath = path.join(projectPath, '.docs');

        // Dedup by normalized path
        const normalizedPath = path.normalize(projectPath).toLowerCase();
        if (seen.has(normalizedPath)) continue;

        if (fs.existsSync(docsPath) && fs.existsSync(path.join(docsPath, '_index.json'))) {
          seen.add(normalizedPath);
          projects.push({ name: entry.name, path: projectPath, docsPath });
        }
      }
    } catch {}
  }

  return projects;
}

/** Read `_index.json` from a docs root, tolerating absence. */
export function readIndexFile(docsRoot: string): { docs: any[] } {
  const indexPath = path.join(docsRoot, '_index.json');
  if (!fs.existsSync(indexPath)) return { docs: [] };
  const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  return { docs: Array.isArray(parsed.docs) ? parsed.docs : [] };
}

export interface DocsApi {
  /** Register these on `server.middlewares`, in order. */
  middlewares: Middleware[];
  /** Current docs root — moves when `/api/projects/select` succeeds. */
  getDocsRoot(): string;
}

export function createDocsApi(opts: {
  docsRoot: string;
  /** Injected so tests can define the allowlist without touching the real disk. */
  findProjects: () => Project[];
}): DocsApi {
  let docsRoot = opts.docsRoot;
  const discoverProjects = opts.findProjects;

  // ---- /api/projects -------------------------------------------------------
  const projectsMiddleware: Middleware = (req, res, next) => {
    if (!req.url?.startsWith('/api/projects')) return next();

    res.setHeader('Content-Type', 'application/json');

    try {
      // GET /api/projects - List all projects with .docs
      if (req.url === '/api/projects' || req.url === '/api/projects/') {
        const projects = discoverProjects();
        const currentProject = projects.find(p => p.docsPath === docsRoot);
        res.end(JSON.stringify({
          projects,
          current: currentProject?.path || docsRoot.replace('/.docs', '').replace('\\.docs', ''),
        }));
        return;
      }

      // POST /api/projects/select - Switch to a different project
      if (req.url === '/api/projects/select' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { path: projectPath } = JSON.parse(body);

            // SECURITY: this used to accept ANY path on disk, and because the
            // handler JSON.parses regardless of Content-Type it is a CORS
            // *simple* request — no preflight — so any page the developer
            // visited could silently repoint the viewer with a no-cors fetch.
            // `docsRoot` also becomes the cwd for git subprocesses via
            // `projectRoot`, so this was not merely a display concern.
            //
            // Only projects the server itself discovered are selectable.
            const allowed = discoverProjects();
            const match = allowed.find(p => path.resolve(p.path) === path.resolve(String(projectPath ?? '')));
            if (!match) {
              res.statusCode = 403;
              res.end(JSON.stringify({
                error: 'Project not in the discovered set',
                hint: 'Only projects listed by GET /api/projects can be selected.',
                path: projectPath,
              }));
              return;
            }

            if (fs.existsSync(match.docsPath)) {
              docsRoot = match.docsPath;
              res.end(JSON.stringify({ success: true, docsRoot }));
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'No .docs folder found', path: projectPath }));
            }
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
        return;
      }

      // Anything else under /api/projects: 404 explicitly. Falling through
      // without calling next() or ending the response left the socket open
      // forever — a GET to /api/projects/select hung until timeout, and a
      // handful of those exhaust the browser's per-origin connection pool
      // and wedge the whole viewer.
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found', path: req.url }));
      return;
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  };

  // ---- /api/docs -----------------------------------------------------------
  const docsMiddleware: Middleware = (req, res, next) => {
    if (!req.url?.startsWith('/api/docs')) return next();

    res.setHeader('Content-Type', 'application/json');

    try {
      // GET /api/docs - List all docs
      if (req.url === '/api/docs' || req.url === '/api/docs/') {
        const indexPath = path.join(docsRoot, '_index.json');
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          res.end(JSON.stringify(index));
        } else {
          res.end(JSON.stringify({ version: 1, docs: [], lastUpdated: null }));
        }
        return;
      }

      // GET /api/docs/search?q=query - Search docs
      if (req.url?.startsWith('/api/docs/search')) {
        const url = new URL(req.url, 'http://localhost');
        const query = url.searchParams.get('q')?.toLowerCase() || '';

        const indexPath = path.join(docsRoot, '_index.json');
        if (!fs.existsSync(indexPath)) {
          res.end(JSON.stringify({ results: [] }));
          return;
        }

        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const results = index.docs
          .filter((doc: any) => {
            // Search in title, tags, path
            const searchable = `${doc.title} ${doc.tags?.join(' ') || ''} ${doc.path}`.toLowerCase();
            return query.split(' ').every((term: string) => searchable.includes(term));
          })
          .slice(0, 20);

        res.end(JSON.stringify({ results, query }));
        return;
      }

      // GET /api/docs/:path - Get a specific doc
      //
      // SECURITY: `docPath` is attacker-controlled. Without containment this
      // served ANY .mdx file on the machine — verified exploitable with
      // `curl --path-as-is '/api/docs/../../../../etc/whatever'`, which
      // returned the file body in `raw`. It is not a localhost-only concern
      // either: `server.host` is '0.0.0.0', so every device on the same
      // network could read the developer's disk unauthenticated.
      //
      // Strip the query string (otherwise `foo?x=1` becomes a literal path
      // segment), decode percent-escapes so `%2e%2e` cannot smuggle a
      // traversal past the check, then resolve and require the result to
      // stay inside docsRoot.
      const rawPath = req.url.replace('/api/docs/', '').split('?')[0].split('#')[0];
      let docPath: string;
      try {
        docPath = decodeURIComponent(rawPath);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Malformed path' }));
        return;
      }

      const rootResolved = path.resolve(docsRoot);
      const filePath = path.resolve(rootResolved, `${docPath}.mdx`);
      if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Path outside docs root', path: docPath }));
        return;
      }

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseMdx(content);

        // Get metadata from index
        const indexPath = path.join(docsRoot, '_index.json');
        let metadata = {};
        if (fs.existsSync(indexPath)) {
          const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          const docMeta = index.docs.find((d: any) => d.path === docPath);
          if (docMeta) metadata = docMeta;
        }

        res.end(JSON.stringify({
          ...metadata,
          path: docPath,
          blocks: parsed.blocks,
          raw: content,
        }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Doc not found', path: docPath }));
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  };

  // ---- /api/coverage, /api/drift, /api/coverage/trend ----------------------
  // Trust surface (PRODUCT_ROADMAP Phase 2): real coverage and per-doc drift.
  //
  // Both compute against the PROJECT root — the parent of the docs root, not
  // the dev server's cwd (which is frontend/). `docsRoot` is switchable at
  // runtime via POST /api/projects/select, so it is read per request rather
  // than captured once.
  const trustMiddleware: Middleware = (req, res, next) => {
    const url = req.url?.split('?')[0];
    if (url !== '/api/coverage' && url !== '/api/drift' && url !== '/api/coverage/trend') {
      return next();
    }

    res.setHeader('Content-Type', 'application/json');
    const projectRoot = path.dirname(docsRoot);

    void (async () => {
      try {
        const { docs } = readIndexFile(docsRoot);

        if (url === '/api/coverage') {
          const { computeCoverage } = await import('../src/coverage');
          res.end(JSON.stringify(await computeCoverage({ rootDir: projectRoot, docs, limit: 25 })));
          return;
        }

        // Coverage over time, derived from git history — no persisted state.
        if (url === '/api/coverage/trend') {
          const { computeCoverageTrend } = await import('../src/trend');
          const points = Number(new URL(req.url!, 'http://x').searchParams.get('points'));
          const maxPoints = Number.isFinite(points) && points > 0 ? Math.min(points, 200) : 40;
          res.end(JSON.stringify(await computeCoverageTrend(projectRoot, { maxPoints })));
          return;
        }

        // /api/drift — per-doc status keyed by path, for the verified badge.
        const { computeDrift } = await import('../src/drift');
        // emit:false — rendering a badge must not write to the suite spine.
        const report = await computeDrift(projectRoot, { emit: false });
        const byPath: Record<string, unknown> = {};
        for (const r of [...report.broken, ...report.drifted, ...report.unverified, ...report.clean]) {
          byPath[r.path] = {
            status: r.status,
            verifiedCommit: r.verifiedCommit,
            changedFiles: r.changedFiles,
            ...(r.brokenFiles ? { brokenFiles: r.brokenFiles } : {}),
          };
        }
        res.end(JSON.stringify({
          gitRepo: report.gitRepo,
          head: report.head,
          ...(report.error ? { error: report.error } : {}),
          docs: byPath,
          summary: {
            clean: report.clean.length,
            drifted: report.drifted.length,
            broken: report.broken.length,
            unverified: report.unverified.length,
          },
        }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(error) }));
      }
    })();
  };

  return {
    middlewares: [projectsMiddleware, docsMiddleware, trustMiddleware],
    getDocsRoot: () => docsRoot,
  };
}

// Parse MDX file into blocks
export function parseMdx(content: string): { metadata: Record<string, any>; blocks: any[] } {
  const blocks: any[] = [];
  let metadata: Record<string, any> = {};

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  let body = content;

  if (frontmatterMatch) {
    body = content.slice(frontmatterMatch[0].length);
    const yaml = frontmatterMatch[1];

    // Simple YAML parsing
    yaml.split('\n').forEach(line => {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (value.startsWith('[')) {
          // Array
          try {
            metadata[key] = JSON.parse(value.replace(/'/g, '"'));
          } catch {
            metadata[key] = value;
          }
        } else if (value.startsWith('"') || value.startsWith("'")) {
          metadata[key] = value.slice(1, -1);
        } else if (!isNaN(Number(value))) {
          metadata[key] = Number(value);
        } else {
          metadata[key] = value;
        }
      }
    });
  }

  // Parse body into blocks
  const lines = body.trim().split('\n');
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeContent: string[] = [];
  let inCallout = false;
  let calloutType = 'info';
  let calloutContent: string[] = [];
  let blockId = 0;

  const createId = () => `b${++blockId}`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeContent = [];
      } else {
        // End code block
        if (codeBlockLang === 'mermaid') {
          blocks.push({
            id: createId(),
            type: 'diagram',
            content: codeContent.join('\n'),
            metadata: { diagramData: { mermaid: codeContent.join('\n') } }
          });
        } else {
          blocks.push({
            id: createId(),
            type: 'code',
            content: codeContent.join('\n'),
            metadata: { language: codeBlockLang || 'text' }
          });
        }
        inCodeBlock = false;
        codeBlockLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Handle multi-line callout
    if (inCallout) {
      if (line.includes('</Callout>')) {
        // End of callout - add content before closing tag
        const beforeClose = line.replace('</Callout>', '').trim();
        if (beforeClose) calloutContent.push(beforeClose);
        blocks.push({
          id: createId(),
          type: 'callout',
          content: calloutContent.join(' ').trim(),
          metadata: { level: calloutType }
        });
        inCallout = false;
        calloutContent = [];
      } else {
        calloutContent.push(line);
      }
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      blocks.push({ id: createId(), type: 'heading-1', content: line.slice(2) });
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ id: createId(), type: 'heading-2', content: line.slice(3) });
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({ id: createId(), type: 'heading-3', content: line.slice(4) });
      continue;
    }

    // Divider
    if (line === '---') {
      blocks.push({ id: createId(), type: 'divider', content: '' });
      continue;
    }

    // MDX components - Callout (handles both single and multi-line)
    if (line.startsWith('<Callout')) {
      const typeMatch = line.match(/type="(\w+)"/);
      calloutType = typeMatch ? typeMatch[1] : 'info';

      // Check if it's a single-line callout (has closing tag on same line)
      if (line.includes('</Callout>')) {
        const content = line.replace(/<Callout[^>]*>/, '').replace('</Callout>', '').trim();
        blocks.push({
          id: createId(),
          type: 'callout',
          content,
          metadata: { level: calloutType }
        });
      } else {
        // Multi-line callout - start collecting content
        inCallout = true;
        calloutContent = [];
        // Get any content after the opening tag on the same line
        const afterTag = line.replace(/<Callout[^>]*>/, '').trim();
        if (afterTag) calloutContent.push(afterTag);
      }
      continue;
    }

    // React Flow diagram - extract JSON properly
    if (line.startsWith('<ReactFlow')) {
      try {
        // Find the start of data={
        const dataStart = line.indexOf('data={');
        if (dataStart !== -1) {
          // Extract everything after data={ and find matching }
          const jsonStart = dataStart + 6; // length of 'data={'
          let braceCount = 1;
          let jsonEnd = jsonStart;
          for (let j = jsonStart; j < line.length && braceCount > 0; j++) {
            if (line[j] === '{') braceCount++;
            else if (line[j] === '}') braceCount--;
            if (braceCount === 0) jsonEnd = j;
          }
          const jsonStr = line.slice(jsonStart, jsonEnd);
          const data = JSON.parse(jsonStr);
          blocks.push({
            id: createId(),
            type: 'diagram',
            content: '',
            metadata: { diagramData: data }
          });
        }
      } catch (e) {
        // If JSON parsing fails, still add as diagram placeholder
        blocks.push({
          id: createId(),
          type: 'diagram',
          content: 'Diagram data could not be parsed',
          metadata: { diagramData: {} }
        });
      }
      continue;
    }

    // Whiteboard - extract JSON properly
    if (line.startsWith('<Whiteboard')) {
      try {
        const dataStart = line.indexOf('data={');
        if (dataStart !== -1) {
          const jsonStart = dataStart + 6;
          let braceCount = 1;
          let jsonEnd = jsonStart;
          for (let j = jsonStart; j < line.length && braceCount > 0; j++) {
            if (line[j] === '{') braceCount++;
            else if (line[j] === '}') braceCount--;
            if (braceCount === 0) jsonEnd = j;
          }
          const jsonStr = line.slice(jsonStart, jsonEnd);
          const data = JSON.parse(jsonStr);
          blocks.push({
            id: createId(),
            type: 'whiteboard',
            content: '',
            metadata: { whiteboardData: data }
          });
        }
      } catch {
        blocks.push({
          id: createId(),
          type: 'whiteboard',
          content: '',
          metadata: { whiteboardData: {} }
        });
      }
      continue;
    }

    // Skip closing tags that might be on their own line
    if (line.trim() === '</Callout>' || line.trim() === '</ReactFlow>' || line.trim() === '</Whiteboard>') {
      continue;
    }

    // Table component - extract JSON properly (like ReactFlow)
    if (line.startsWith('<Table')) {
      try {
        const dataStart = line.indexOf('data={');
        if (dataStart !== -1) {
          const jsonStart = dataStart + 6;
          let braceCount = 1;
          let jsonEnd = jsonStart;
          for (let j = jsonStart; j < line.length && braceCount > 0; j++) {
            if (line[j] === '{') braceCount++;
            else if (line[j] === '}') braceCount--;
            if (braceCount === 0) jsonEnd = j;
          }
          const jsonStr = line.slice(jsonStart, jsonEnd);
          const data = JSON.parse(jsonStr);
          blocks.push({
            id: createId(),
            type: 'table',
            content: '',
            metadata: { headers: data.headers || [], rows: data.rows || [] }
          });
        }
      } catch {
        blocks.push({
          id: createId(),
          type: 'table',
          content: '',
          metadata: { headers: [], rows: [] }
        });
      }
      continue;
    }

    // Markdown table
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows: string[] = [line];
      // Collect all consecutive table rows
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.startsWith('|') && nextLine.endsWith('|')) {
          tableRows.push(lines[i + 1]);
          i++;
        } else {
          break;
        }
      }

      // Parse table: first row is header, second is separator (skip), rest are data
      if (tableRows.length >= 2) {
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(cell => cell.trim());

        const headers = parseRow(tableRows[0]);
        const rows: string[][] = [];

        for (let r = 1; r < tableRows.length; r++) {
          const row = tableRows[r];
          // Skip separator row (contains only dashes and pipes)
          if (/^\|[\s\-:|]+\|$/.test(row.trim())) continue;
          rows.push(parseRow(row));
        }

        blocks.push({
          id: createId(),
          type: 'table',
          content: '',
          metadata: { headers, rows }
        });
      }
      continue;
    }

    // Regular paragraph
    if (line.trim()) {
      blocks.push({ id: createId(), type: 'paragraph', content: line });
    }
  }

  return { metadata, blocks };
}
