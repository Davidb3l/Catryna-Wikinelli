import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The viewer must not reach a third-party origin to render.
 *
 * It reached three, and each one cost something real:
 *   - `cdn.tailwindcss.com` compiled Tailwind in the browser on every page load
 *   - `esm.sh` served reactflow's and tldraw's CSS from a render-blocking
 *     `<link>`; the tldraw URL was pinned to a stale canary and had started
 *     returning HTTP 500, so the whiteboard rendered unstyled
 *   - `fonts.googleapis.com` blocked first paint on a cross-origin stylesheet,
 *     then pulled woff2 from a second origin
 *
 * All three are gone. This test exists so the next one is noticed on the way in
 * rather than during an outage — the failure mode is silent while you have
 * network, which is exactly when nobody is looking.
 *
 * SCOPE, stated honestly: this scans the source WE control. It cannot see
 * origins baked into a dependency's own bundle, and that blind spot has now
 * bitten TWICE — tldraw fetched its icons and fonts from `cdn.tldraw.com`, and
 * Excalidraw falls back to `esm.sh` for its scene fonts unless
 * `EXCALIDRAW_ASSET_PATH` is set. Both were missed by a browser check that
 * opened the whiteboard without USING it: the request only fires when a font is
 * actually needed.
 *
 * So the Excalidraw case is pinned by an explicit assertion below rather than
 * by a scan. The general limit still stands for any future dependency: if a
 * package can phone home, no source-text test here will see it.
 */

const here = import.meta.dir;
const read = (p: string) => readFileSync(join(here, p), 'utf-8');

/** Files that ship to the browser and that this repo authors. */
const SOURCE = [
  'index.html',
  'index.css',
  'index.tsx',
  'App.tsx',
  'styles/fonts.css',
  'styles/vendor-reactflow.css',
  'styles/vendor-excalidraw.css',
  'components/Trust.tsx',
  'components/ErrorBoundary.tsx',
  'components/LazyCanvas.tsx',
  'components/MermaidDiagram.tsx',
  'components/FlowDiagram.tsx',
  'components/WhiteboardCanvas.tsx',
  'components/TurboNode.tsx',
  'components/TurboEdge.tsx',
  'hooks/useDocs.ts',
  'hooks/useSystemTheme.ts',
];

/**
 * Hosts allowed to appear. These must never be FETCHED — they are documentation
 * links and XML namespaces. Anything that would become a network request at
 * render time belongs nowhere on this list.
 */
const ALLOWED = new Set([
  'www.w3.org',      // SVG/XML namespace URI, never fetched
  'reactflow.dev',   // a comment pointing at the Turbo Flow example
  'catrynawiki.com', // referenced in prose/comments only
]);

/** Origins that were removed and must not come back. */
const BANNED = ['cdn.tailwindcss.com', 'esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.tldraw.com'];

describe('the viewer renders without a third-party origin', () => {
  for (const file of SOURCE) {
    test(`${file} introduces no external origin`, () => {
      const src = read(file);
      const hosts = [...src.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)].map(m => m[1]);
      const unexpected = [...new Set(hosts)].filter(h => !ALLOWED.has(h));
      expect(`${file}: ${unexpected.join(', ') || 'none'}`).toBe(`${file}: none`);
    });
  }

  test('the three origins that were removed have not returned', () => {
    // Named explicitly: each was a real outage or a real cost, and a diff that
    // reintroduces one should fail loudly rather than blend into the noise.
    for (const file of SOURCE) {
      const src = read(file);
      for (const host of BANNED) {
        // A comment may name them — this repo's comments explain why they went.
        const live = src
          .split('\n')
          .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l))
          .join('\n');
        expect(`${file} still uses ${host}: ${live.includes(host)}`)
          .toBe(`${file} still uses ${host}: false`);
      }
    }
  });

  test('Excalidraw is pinned to self-hosted assets, not its esm.sh fallback', () => {
    // Excalidraw builds its font URL list from `window.EXCALIDRAW_ASSET_PATH`
    // and then ALWAYS appends `https://esm.sh/@excalidraw/excalidraw@<v>/dist/prod/`
    // as a fallback. With the global unset that fallback is the only entry, so
    // the whiteboard silently fetches Excalifont from esm.sh the moment anyone
    // types — an origin this very file bans. Verified in the browser: unset it
    // and the request fires; set it and every scene font comes from /public.
    const setter = read('components/excalidraw-asset-path.ts');
    expect(setter).toContain('window.EXCALIDRAW_ASSET_PATH');
    expect(setter).toMatch(/EXCALIDRAW_ASSET_PATH\s*=\s*['"]\/excalidraw-assets\//);

    // …and it must be imported BEFORE the library, or the global is set too late.
    const canvas = read('components/WhiteboardCanvas.tsx');
    const setterAt = canvas.indexOf("./excalidraw-asset-path");
    const libAt = canvas.indexOf("'@excalidraw/excalidraw'");
    expect(`asset-path import present: ${setterAt >= 0}`).toBe('asset-path import present: true');
    expect(`asset-path precedes the library: ${setterAt < libAt}`)
      .toBe('asset-path precedes the library: true');
  });

  test('every Excalidraw scene font family is vendored, CJK included', () => {
    // The asset path only helps if the files are actually there. A copy that
    // misses a family 404s and Excalidraw falls through to its esm.sh fallback
    // WITHOUT complaining — the failure is a network request, not an error.
    // Xiaolai is called out by name because it is 12 MB and therefore the one
    // most likely to get "optimised" back out.
    const dir = join(here, 'public/excalidraw-assets/fonts');
    const families = readdirSync(dir).filter(f => statSync(join(dir, f)).isDirectory());
    for (const fam of ['Xiaolai', 'Excalifont', 'Nunito', 'Virgil', 'Assistant',
                       'Cascadia', 'ComicShanns', 'Liberation', 'Lilita']) {
      expect(`${fam} vendored: ${families.includes(fam)}`).toBe(`${fam} vendored: true`);
    }
    // Xiaolai ships as many subsets; a truncated copy is worse than none.
    const xiaolai = readdirSync(join(dir, 'Xiaolai')).filter(f => f.endsWith('.woff2'));
    expect(`Xiaolai subsets: ${xiaolai.length >= 200}`).toBe('Xiaolai subsets: true');

    // And the licences must travel with the binaries into dist/.
    expect(existsSync(join(here, 'public/excalidraw-assets/OFL.txt'))).toBe(true);
    expect(existsSync(join(here, 'public/excalidraw-assets/README.md'))).toBe(true);
  });

  test('webfonts are declared locally, not fetched from a CDN', () => {
    const fonts = read('styles/fonts.css');
    const srcs = [...fonts.matchAll(/src:\s*url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ''));
    // EVERY subset Google publishes for these four families. The count is 20
    // rather than 28 because Google's own coverage is uneven, and the shortfall
    // is upstream — not something to "fix" here by inventing files:
    //   Inter           7  latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese
    //   JetBrains Mono  6  the same, minus greek-ext
    //   Hanken Grotesk  4  latin, latin-ext, cyrillic-ext, vietnamese
    //   Fraunces        3  latin, latin-ext, vietnamese
    // See styles/fonts.css for what each gap means at render time.
    expect(srcs.length).toBe(20);
    for (const s of srcs) {
      expect(`${s} is relative: ${s.startsWith('../fonts/')}`).toBe(`${s} is relative: true`);
    }

    // A declared src with no file behind it is the quiet failure: the @font-face
    // simply never matches, the subset falls back to a system face, and nothing
    // errors. Cheap to assert, so assert it.
    for (const s of srcs) {
      expect(`${s} exists: ${existsSync(join(here, 'styles', s))}`).toBe(`${s} exists: true`);
    }
  });
});
