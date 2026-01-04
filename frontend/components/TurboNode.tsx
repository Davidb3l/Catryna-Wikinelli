import React, { memo, type ReactNode } from 'react';
import { Handle, Position, type Node, type NodeProps } from 'reactflow';
import { Cloud } from 'lucide-react';

export type TurboNodeData = {
  title?: string;
  label?: string; // backwards compatibility
  icon?: ReactNode;
  subtitle?: string;
};

export const TurboNode = memo(({ data }: NodeProps<Node<TurboNodeData>>) => {
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
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
        </div>
      </div>
    </>
  );
});

TurboNode.displayName = 'TurboNode';

export default TurboNode;
