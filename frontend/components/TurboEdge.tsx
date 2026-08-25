import React from 'react';
import { getSmoothStepPath, type EdgeProps } from 'reactflow';

/**
 * Turbo edge: a smoothstep path stroked with its OWN gradient.
 *
 * The gradient is per-edge and `userSpaceOnUse`, and both of those are
 * deliberate.
 *
 * PER-EDGE, because two shared `<defs>` used to live in `TurboEdgeGradient`,
 * rendered once per canvas — so opening the architecture editor over a doc that
 * already showed a diagram put two elements with the same `id` in one document.
 * Benign while the copies were identical, and silently wrong the moment they
 * were not: `url(#id)` takes the first in document order.
 *
 * `userSpaceOnUse`, because the default `objectBoundingBox` is measured against
 * the path's bounding box — and a perfectly VERTICAL or HORIZONTAL edge has a
 * bounding box with zero width or height. SVG then ignores the paint server and
 * the edge renders as nothing at all. Not theoretical: `normalizeNodes` defaults
 * every node to Bottom -> Top handles, so a vertically stacked pair produces
 * exactly that path, and the editor lets anyone drag into the alignment.
 * Verified with a controlled A/B — identical geometry paints under
 * `userSpaceOnUse` and vanishes under `objectBoundingBox`.
 *
 * Anchoring x1/y1 -> x2/y2 to the edge's own endpoints also keeps the sweep
 * running source-to-target, which is what the shared def gave us and what the
 * Turbo Flow look depends on.
 *
 * The stops read `--turbo-edge-*` from `index.css`, so the theme still owns the
 * colours and light/dark switches with the `.dark` class — no JS involved.
 */
export function TurboEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: 0,
  });

  const gradientId = `turbo-edge-gradient-${id}`;

  return (
    // A single <g>, not a fragment: reactflow's edge wrapper renders the return
    // value into one slot, and handing it two siblings dropped every edge from
    // the DOM (verified — the repo's own diagram went from 7 edge paths to 0).
    <g>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor="var(--turbo-edge-0)" />
          <stop offset="50%" stopColor="var(--turbo-edge-1)" />
          <stop offset="100%" stopColor="var(--turbo-edge-2)" />
        </linearGradient>
      </defs>
      <path
        id={id}
        // Inline, so it beats the `.react-flow__edge-path` rules in index.css
        // without needing `!important` anywhere.
        style={{ ...style, stroke: `url(#${gradientId})` }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd as string}
      />
    </g>
  );
}

export default TurboEdge;
