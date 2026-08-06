import React from 'react';
import { Tldraw } from 'tldraw';

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
