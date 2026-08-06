import React, { useCallback, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Position } from 'reactflow';
import { TurboNode } from './TurboNode';
import { TurboEdge } from './TurboEdge';
import { TurboEdgeGradient } from './TurboEdgeGradient';

/**
 * THE REACT FLOW BOUNDARY.
 *
 * `reactflow` and the three Turbo components that depend on it are imported
 * here and nowhere else, so they land in a chunk fetched only when a doc holds
 * a non-mermaid diagram or the architecture editor is opened. `App.tsx` reaches
 * both exports through `React.lazy`.
 *
 * Node/edge normalization lives here too — it needs the `Position` enum, and a
 * static import of that alone would drag all of reactflow back into the entry
 * chunk. Callers pass the raw stored `diagramData`.
 */

export interface DiagramData {
  nodes?: any[];
  edges?: any[];
}

// Custom node and edge types for Turbo Flow style
const nodeTypes = { turbo: TurboNode };
const edgeTypes = { turbo: TurboEdge };

// Preserve original positions for proper routing
const normalizeNodes = (nodes: any[]) => nodes.map((node) => ({
  ...node,
  type: node.type || 'default',
  sourcePosition: node.sourcePosition || Position.Bottom,
  targetPosition: node.targetPosition || Position.Top,
}));

// Use the turbo edge type with gradient (no arrows - cleaner look)
const normalizeEdges = (edges: any[]) => edges.map((edge) => ({
  ...edge,
  type: edge.type || 'turbo',
}));

/** Read-only canvas embedded in a doc. The caller owns the sized wrapper. */
const FlowDiagram: React.FC<{ diagramData: DiagramData }> = ({ diagramData }) => (
  <>
    <TurboEdgeGradient />
    <ReactFlow
      nodes={normalizeNodes(diagramData.nodes || [])}
      edges={normalizeEdges(diagramData.edges || [])}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      // This canvas is a READ-ONLY view inside a doc, but reactflow defaults
      // `nodesConnectable` to true — so every node offered connection handles
      // that drew a line and then dropped it, there being no `onConnect` and
      // nowhere to persist an edge. Nodes stay draggable: nudging one to read
      // an overlapped label is useful and harmless.
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'turbo' }}
      panOnScroll={false}
      zoomOnScroll={false}
      preventScrolling={false}
    >
      <Background color="#71717a" gap={16} size={1} />
      <Controls showInteractive={false} className="!left-2 !bottom-2 sm:!left-4 sm:!bottom-4" />
    </ReactFlow>
  </>
);

/** Editable canvas for the full-screen architecture editor. */
export const FlowEditorCanvas: React.FC<{ diagramData?: DiagramData }> = ({ diagramData }) => {
  const [nodes, setNodes] = useState(() => normalizeNodes(
    diagramData?.nodes || [{ id: '1', data: { label: 'New Node' }, position: { x: 250, y: 100 } }],
  ));
  const [edges] = useState(() => normalizeEdges(diagramData?.edges || []));

  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds: any) => {
      const updated = [...nds];
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const idx = updated.findIndex((n: any) => n.id === change.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], position: change.position };
        }
      });
      return updated;
    });
  }, []);

  return (
    <>
      <TurboEdgeGradient />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        fitView
        nodesDraggable={true}
        // No `onConnect` handler exists, so dragging from a handle produced a
        // connection line that vanished on release and never became an edge.
        // An affordance that cannot succeed is worse than none — turn it off
        // until there is somewhere for a new edge to be saved to.
        nodesConnectable={false}
        elementsSelectable={true}
        defaultEdgeOptions={{ type: 'turbo' }}
        panOnScroll={false}
        zoomOnScroll={false}
        preventScrolling={false}
      >
        <Background />
        <Controls className="!left-2 !bottom-2 sm:!left-4 sm:!bottom-4" />
        <MiniMap className="!hidden sm:!block" />
      </ReactFlow>
    </>
  );
};

export default FlowDiagram;
