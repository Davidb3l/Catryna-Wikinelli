import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * The entry chunk was 1394 KiB because App.tsx statically imported mermaid,
 * reactflow and tldraw at module scope, so every page view paid for all three
 * even though most docs open none of them. Splitting them out cut the entry to
 * ~251 KiB.
 *
 * That win is one `import` statement away from being silently undone, and
 * nothing else would fail: the app still works, the types still check, the
 * other tests still pass. Only the bundle gets big again. So the boundary
 * itself is the thing under test.
 *
 * These read source text rather than bundle output on purpose — asserting on
 * `vite build` output would be too slow to run on every change.
 *
 * A NOTE ON RIGOUR. The first version of this file was a hardcoded list of
 * five filenames plus a regex that only understood `import … from 'lib'`.
 * Review built mutated bundles and proved two ways past it:
 *   - `import 'tldraw';` (bare, no `from`) -> entry back to 1188 KiB, test PASSED
 *   - `export { Position } from 'reactflow'` in the unchecked `types.ts`
 *     -> entry back to 374 KiB, test PASSED
 * Hence the import-graph walk and the wider grammar below. Keep both.
 */

const here = import.meta.dir;
const read = (p: string) => readFileSync(p, 'utf-8');

/** The libraries that must never be reachable from the entry chunk. */
const HEAVY = ['mermaid', 'reactflow', 'tldraw'] as const;

/** The one module allowed to own each heavy library. */
const OWNER: Record<(typeof HEAVY)[number], string> = {
  mermaid: 'components/MermaidDiagram.tsx',
  reactflow: 'components/FlowDiagram.tsx',
  tldraw: 'components/WhiteboardCanvas.tsx',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `source` pull `lib`'s RUNTIME in at module scope?
 *
 * Covers, because each was proven to defeat the split or to misfire:
 *   import x from 'lib'      import {x} from 'lib'     import * as x from 'lib'
 *   import 'lib'             (bare side-effect — the 1188 KiB hole)
 *   export {x} from 'lib'    export * from 'lib'       (the 374 KiB hole)
 *   import x = require('lib')                          (TS import-equals)
 *   await import('lib')      (top-level await: entry still blocks on it)
 *   import x from'lib'       (no space after `from`)
 *
 * Deliberately NOT flagged, because the compiler erases them:
 *   import type {T} from 'lib'      import type{T} from 'lib'
 *   import {type T} from 'lib'      export type {T} from 'lib'
 * And NOT flagged because it is the boundary itself:
 *   React.lazy(() => import('lib'))  — a non-awaited dynamic import
 */
const staticallyImports = (source: string, lib: string) => {
  const esc = escapeRe(lib);
  // The module specifier: 'lib' or 'lib/sub/path'.
  const spec = String.raw`['"]${esc}(?:/[^'"]*)?['"]`;
  // Delete import statements the compiler erases WHOLESALE, so they cannot trip
  // the value-import patterns below. `import { type Position } from 'reactflow'`
  // emits nothing — flagging it would train people to distrust this test.
  const withoutTypeOnlyBraces = source.replace(
    /^[ \t]*(?:import|export)[ \t]*\{([^}]*)\}[ \t]*from[ \t]*['"][^'"]*['"];?[ \t]*$/gm,
    (whole, inner: string) => {
      const parts = inner.split(',').map(s => s.trim()).filter(Boolean);
      return parts.length > 0 && parts.every(p => /^type\s/.test(p)) ? '' : whole;
    },
  );
  const pattern = new RegExp(
    [
      // import|export … from 'lib'  — but not `import type` / `export type`
      String.raw`^[ \t]*(?:import|export)\b(?![ \t]+type[ \t{])(?:[^;'"]|'(?!${esc})[^']*'|"(?!${esc})[^"]*")*?from[ \t]*${spec}`,
      // export * from 'lib'  (no `from`-less form, but keep it explicit)
      String.raw`^[ \t]*export[ \t]+\*[ \t]+from[ \t]*${spec}`,
      // bare side-effect import
      String.raw`^[ \t]*import[ \t]*${spec}`,
      // TS import-equals
      String.raw`^[ \t]*import[ \t]+\w+[ \t]*=[ \t]*require\([ \t]*${spec}`,
      // top-level await import()
      String.raw`await[ \t]+import\([ \t]*${spec}`,
    ].join('|'),
    'm',
  );
  return pattern.test(withoutTypeOnlyBraces);
};

/**
 * Every module the entry chunk pulls in eagerly, walked from `index.tsx`.
 *
 * Derived rather than listed, so it cannot rot: a new eager component is
 * covered the moment it is imported. `import type` edges are skipped (erased at
 * compile time) and so are `import()` edges — those ARE the lazy boundaries.
 */
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

const eagerGraph = (entry: string): string[] => {
  const seen = new Set<string>();
  const queue = [resolve(here, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const src = read(file);
    const edges = [
      ...src.matchAll(
        /^[ \t]*(?:import|export)\b(?![ \t]+type[ \t{])[^;]*?from[ \t]*['"](\.[^'"]*)['"]/gm,
      ),
      ...src.matchAll(/^[ \t]*import[ \t]*['"](\.[^'"]*)['"]/gm),
    ];
    for (const edge of edges) {
      const base = resolve(dirname(file), edge[1]);
      const hit = EXTENSIONS.map(e => base + e).find(
        p => existsSync(p) && statSync(p).isFile(),
      );
      if (hit) queue.push(hit);
    }
  }
  return [...seen].map(f => relative(here, f)).sort();
};

describe('heavy libraries stay behind the lazy boundary', () => {
  const EAGER = eagerGraph('index.tsx');

  test('the eager module graph is what we think it is', () => {
    // Not busywork: every assertion below is scoped to this set, so a module
    // silently joining it would be a module silently going unchecked. If you
    // added a component and this fails, confirm it genuinely belongs in the
    // entry chunk, then add it here.
    expect(EAGER).toEqual([
      'App.tsx',
      'components/ErrorBoundary.tsx',
      'components/LazyCanvas.tsx',
      'components/Trust.tsx',
      'hooks/useDocs.ts',
      'hooks/useSystemTheme.ts',
      'index.css',
      'index.tsx',
      'types.ts',
    ]);
  });

  for (const lib of HEAVY) {
    test(`no eager module imports ${lib}`, () => {
      for (const file of EAGER) {
        if (!/\.(ts|tsx)$/.test(file)) continue;
        expect(`${file} imports ${lib}: ${staticallyImports(read(join(here, file)), lib)}`)
          .toBe(`${file} imports ${lib}: false`);
      }
    });

    test(`${OWNER[lib]} still owns ${lib}`, () => {
      // So a rename cannot leave the lazy module importing nothing while the
      // test above passes for the wrong reason.
      expect(staticallyImports(read(join(here, OWNER[lib])), lib)).toBe(true);
    });
  }

  test('App.tsx reaches each boundary module through a dynamic import', () => {
    const app = read(join(here, 'App.tsx'));
    for (const module of Object.values(OWNER)) {
      const specifier = escapeRe(`./${module.replace(/\.tsx$/, '')}`);
      // Quote-agnostic, so a formatter change cannot fail this.
      expect(app).toMatch(new RegExp(String.raw`import\([ \t]*['"]${specifier}['"]`));
    }
  });

  test('EVERY lazy component usage is wrapped in <LazyCanvas>', () => {
    // Comments are stripped first, or `{/* wrap this in <LazyCanvas later */}`
    // sitting above an unwrapped component satisfies the position check. Indices
    // stay self-consistent because usages are found in the stripped text too.
    const app = read(join(here, 'App.tsx'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const lazyNames = ['MermaidDiagram', 'FlowDiagram', 'FlowEditorCanvas', 'WhiteboardCanvas'];
    for (const name of lazyNames) {
      const usages = [...app.matchAll(new RegExp(String.raw`<${name}[\s/>]`, 'g'))];
      // A lazy component that is never rendered means this test is asserting
      // nothing — catch that rather than pass vacuously.
      expect(`${name} rendered: ${usages.length > 0}`).toBe(`${name} rendered: true`);
      // Check EVERY usage, not just the first: a second, unwrapped usage used
      // to slip through entirely.
      for (const usage of usages) {
        const before = app.slice(0, usage.index);
        const open = before.lastIndexOf('<LazyCanvas');
        const close = before.lastIndexOf('</LazyCanvas>');
        expect(`${name}@${usage.index} inside LazyCanvas: ${open > close}`)
          .toBe(`${name}@${usage.index} inside LazyCanvas: true`);
      }
    }
  });

  test('LazyCanvas supplies BOTH a Suspense fallback and an error boundary', () => {
    // The wrapper is what makes the test above sufficient. If it ever stops
    // catching errors, one 404'd chunk takes the whole viewer down again.
    const src = read(join(here, 'components/LazyCanvas.tsx'));
    expect(src).toContain('<React.Suspense');
    expect(src).toContain('getDerivedStateFromError');
  });
});
