import React from 'react';
import { Tldraw } from 'tldraw';
/**
 * The stylesheet comes from node_modules and rides this lazy chunk.
 *
 * It used to be a render-blocking `<link>` in index.html pointing at
 * `esm.sh/tldraw@2.0.0-canary.c41d8e14798e/tldraw.css` — a THIRD-PARTY CDN
 * round-trip before first paint, on every page view, for a canvas almost
 * nobody opens. It was also pinned to a canary release while package.json
 * installed 2.4.x, and that URL had started returning **HTTP 500**, so the
 * whiteboard rendered unstyled and the network cost bought nothing.
 *
 * Importing it here means: no CDN, no version skew (it tracks package.json by
 * construction), and the CSS is fetched only when the whiteboard is opened.
 */
import '../styles/vendor-tldraw.css';

/**
 * THE TLDRAW BOUNDARY.
 *
 * `tldraw` is imported here and nowhere else, so it is fetched only when the
 * whiteboard editor is actually opened (`activeEditor === 'wb'`). `App.tsx`
 * reaches this through `React.lazy`; the editor chrome around it stays eager so
 * the modal opens instantly and the canvas fills in.
 */
const WhiteboardCanvas: React.FC = () => <Tldraw />;

export default WhiteboardCanvas;
