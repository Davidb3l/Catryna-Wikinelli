import React from 'react';
// MUST precede the Excalidraw import — see the file for why.
import './excalidraw-asset-path';
import { Excalidraw } from '@excalidraw/excalidraw';
/**
 * The stylesheet comes from node_modules and rides this lazy chunk — see the
 * layer note in styles/vendor-excalidraw.css.
 */
import '../styles/vendor-excalidraw.css';

/**
 * THE WHITEBOARD BOUNDARY.
 *
 * `@excalidraw/excalidraw` is imported here and nowhere else, so it is fetched
 * only when the whiteboard editor is actually opened (`activeEditor === 'wb'`).
 * `App.tsx` reaches this through `React.lazy`; the editor chrome around it stays
 * eager so the modal opens instantly and the canvas fills in.
 *
 * WHY NOT TLDRAW. tldraw 2.4.6 is not open source in the permissive sense: its
 * licence is source-available and **non-commercial only** ("you may not use or
 * distribute this Software … for commercial purposes … including for internal
 * products within commercial entities"). This repo ships under MIT and is
 * published publicly, so anyone installing it for internal docs at a company
 * would have been in violation with nothing telling them. Excalidraw is MIT.
 *
 * It also removed the last third-party origin: tldraw fetched its icons,
 * translations and four of its own webfonts from `cdn.tldraw.com` at runtime.
 */
const WhiteboardCanvas: React.FC = () => (
  <Excalidraw
    // Nothing persists — the docs API is GET-only and `updateDoc` still
    // round-trips through the lossy parser. The ScratchpadNotice above the
    // canvas says so; do not add a save handler here without a write path.
    UIOptions={{ canvasActions: { saveToActiveFile: false, export: false, loadScene: false } }}
  />
);

export default WhiteboardCanvas;
