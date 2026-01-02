import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Scan common directories for projects with .docs folders
function findProjects(): { name: string; path: string; docsPath: string }[] {
  const projects: { name: string; path: string; docsPath: string }[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // Directories to scan for projects
  // Priority: PROJECTS_ROOT env var > sibling projects > common dev directories
  const scanDirs: string[] = [];

  // 1. User-specified projects root (set PROJECTS_ROOT env var)
  if (process.env.PROJECTS_ROOT) {
    scanDirs.push(process.env.PROJECTS_ROOT);
  }

  // 2. Parent directory (sibling projects to Catryna)
  scanDirs.push(path.resolve(__dirname, '..'));

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

  const seen = new Set<string>();

  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir)) continue;

    try {
      const entries = fs.readdirSync(scanDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = path.join(scanDir, entry.name);
        const docsPath = path.join(projectPath, '.docs');

        // Skip if already found (dedup by normalized path)
        const normalizedPath = path.normalize(projectPath).toLowerCase();
        if (seen.has(normalizedPath)) continue;

        if (fs.existsSync(docsPath) && fs.existsSync(path.join(docsPath, '_index.json'))) {
          seen.add(normalizedPath);
          projects.push({
            name: entry.name,
            path: projectPath,
            docsPath: docsPath,
          });
        }
      }
    } catch {}
  }

  return projects;
}

// Plugin to serve .docs folder as API
// Set DOCS_ROOT env var to point to a different project's .docs folder
function docsApiPlugin(): Plugin {
  let docsRoot = process.env.DOCS_ROOT || path.resolve(__dirname, '../.docs');

  return {
    name: 'docs-api',
    configureServer(server) {
      // API routes for projects
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/projects')) {
          return next();
        }

        res.setHeader('Content-Type', 'application/json');

        try {
          // GET /api/projects - List all projects with .docs
          if (req.url === '/api/projects' || req.url === '/api/projects/') {
            const projects = findProjects();
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
                const newDocsRoot = path.join(projectPath, '.docs');
                if (fs.existsSync(newDocsRoot)) {
                  docsRoot = newDocsRoot;
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
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });

      // API routes for docs
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/docs')) {
          return next();
        }

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
          const docPath = req.url.replace('/api/docs/', '');
          const filePath = path.join(docsRoot, `${docPath}.mdx`);

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
      });
    }
  };
}

// Parse MDX file into blocks
function parseMdx(content: string): { metadata: Record<string, any>; blocks: any[] } {
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

    // Regular paragraph
    if (line.trim()) {
      blocks.push({ id: createId(), type: 'paragraph', content: line });
    }
  }

  return { metadata, blocks };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 6969,
      strictPort: false, // Auto-find next available port if 6969 is taken
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      docsApiPlugin(),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
