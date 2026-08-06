import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The entry chunk was 1394 KiB because App.tsx statically imported mermaid,
 * reactflow and tldraw at module scope — so every page view paid for all three
 * even though most docs open none of them. Splitting them out cut the entry to
 * ~251 KiB.
 *
 * That win is one `import` statement away from being silently undone, and
 * nothing else would fail: the app still works, the types still check, the
 * tests still pass. Only the bundle gets big again. So the boundary itself is
 * the thing under test.
 *
 * These read source text rather than bundle output on purpose — a build-output
 * assertion needs a full `vite build` and would be too slow to run every time.
 */

const here = import.meta.dir;
const read = (p: string) => readFileSync(join(here, p), 'utf-8');

/** The libraries that must never be reachable from the entry chunk. */
const HEAVY = ['mermaid', 'reactflow', 'tldraw'] as const;

/** The one module allowed to import each heavy library. */
const OWNER: Record<(typeof HEAVY)[number], string> = {
  mermaid: 'components/MermaidDiagram.tsx',
  reactflow: 'components/FlowDiagram.tsx',
  tldraw: 'components/WhiteboardCanvas.tsx',
};

/**
 * A *value* import of `lib`, i.e. one that pulls the runtime in. `import type`
 * is erased by the compiler and is fine — `App.tsx` legitimately imports the
 * `DiagramData` type from the reactflow boundary module.
 */
const staticallyImports = (source: string, lib: string) => {
  const pattern = new RegExp(
    String.raw`^\s*import\s+(?!type\s)[^;]*?from\s+['"]${lib}(?:/[^'"]*)?['"]`,
    'm',
  );
  return pattern.test(source);
};

describe('heavy libraries stay behind the lazy boundary', () => {
  const app = read('App.tsx');

  for (const lib of HEAVY) {
    test(`App.tsx does not statically import ${lib}`, () => {
      expect(staticallyImports(app, lib)).toBe(false);
    });

    test(`only ${OWNER[lib]} imports ${lib}`, () => {
      // Everything App.tsx can reach eagerly. If one of these grew a static
      // import of a heavy library it would land in the entry chunk just the
      // same, so they are checked too.
      const eager = [
        'App.tsx',
        'index.tsx',
        'components/Trust.tsx',
        'components/ErrorBoundary.tsx',
        'hooks/useDocs.ts',
      ];
      for (const file of eager) {
        expect(`${file}:${staticallyImports(read(file), lib)}`).toBe(`${file}:false`);
      }
      // …and the owner really does own it, so a rename cannot leave the lazy
      // component importing nothing while this test still passes.
      expect(staticallyImports(read(OWNER[lib]), lib)).toBe(true);
    });
  }

  test('App.tsx reaches each boundary module through React.lazy', () => {
    for (const module of Object.values(OWNER)) {
      const specifier = `./${module.replace(/\.tsx$/, '')}`;
      expect(app).toContain(`import('${specifier}')`);
    }
  });

  test('every lazy component is wrapped in a Suspense boundary', () => {
    // Without this, React throws "A component suspended while responding to
    // synchronous input" and the ErrorBoundary swallows the whole doc.
    const lazyNames = ['MermaidDiagram', 'FlowDiagram', 'FlowEditorCanvas', 'WhiteboardCanvas'];
    for (const name of lazyNames) {
      const usage = app.indexOf(`<${name} `) >= 0 ? app.indexOf(`<${name} `) : app.indexOf(`<${name} /`);
      expect(`${name} rendered:${usage >= 0}`).toBe(`${name} rendered:true`);
      const before = app.slice(0, usage);
      const openSuspense = before.lastIndexOf('<React.Suspense');
      const closeSuspense = before.lastIndexOf('</React.Suspense>');
      expect(`${name} suspended:${openSuspense > closeSuspense}`).toBe(`${name} suspended:true`);
    }
  });
});
