import React, { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Cloud } from 'lucide-react';

export type TurboNodeData = {
  title?: string;
  label?: string; // backwards compatibility
  icon?: ReactNode;
  subtitle?: string;
};

/**
 * `isConnectable` MUST be forwarded to both Handles.
 *
 * reactflow resolves the canvas-level `nodesConnectable` and hands the result to
 * each custom node as a prop — it is not read from the store by `Handle`, whose
 * own default is `true`. A custom node that ignores the prop therefore keeps
 * fully live handles on a canvas that has connections switched off: crosshair
 * cursor, `handlePointerDown` still firing, click-connect still latching into a
 * `clickconnecting` state — while `ConnectionLineWrapper` (which *does* read the
 * store) draws no line to explain any of it. Strictly worse than leaving
 * connections on.
 *
 * The built-in node types forward it, which is why this stayed invisible: the
 * only React Flow diagram in this repo uses `input`/`output`/default nodes.
 */
export const TurboNode = memo(({ data, isConnectable }: NodeProps<TurboNodeData>) => {
  return (
    <>
      <div className="cloud gradient">
        <div>
          <Cloud size={14} />
        </div>
      </div>
      <div className="wrapper gradient">
        <div className="inner">
          <div className="body">
            {data.icon && <div className="icon">{data.icon}</div>}
            <div>
              <div className="title">{data.title || data.label}</div>
              {data.subtitle && <div className="subtitle">{data.subtitle}</div>}
            </div>
          </div>
          <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
          <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
        </div>
      </div>
    </>
  );
});

TurboNode.displayName = 'TurboNode';

export default TurboNode;
