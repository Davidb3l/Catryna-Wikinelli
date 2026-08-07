/**
 * Point Excalidraw at the SELF-HOSTED fonts in `public/excalidraw-assets/`.
 *
 * Without this, Excalidraw's font loader falls back to
 * `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/` — the CDN this
 * project spent several commits removing, and an origin its own
 * `third-party-origins.test.ts` bans by name. The failure is invisible on the
 * happy path: the canvas opens, the toolbar renders, nothing looks wrong. The
 * request only fires when a font is actually needed — pick the text tool and
 * type, and Excalifont is fetched from esm.sh.
 *
 * That is why the earlier "zero external requests" measurement missed it: it
 * measured opening the whiteboard, not USING it.
 *
 * Must be imported BEFORE `@excalidraw/excalidraw` so the global is set before
 * any font resolution runs. ES module evaluation follows import order, so the
 * import at the top of WhiteboardCanvas.tsx is what guarantees it.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

export {};
