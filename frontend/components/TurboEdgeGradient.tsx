import React from 'react';

// SVG gradient definition for turbo edges
export function TurboEdgeGradient() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <linearGradient id="turbo-edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#e92a67" />
          <stop offset="50%" stopColor="#a853ba" />
          <stop offset="100%" stopColor="#2a8af6" />
        </linearGradient>
        <linearGradient id="turbo-edge-gradient-light" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#635BFF" />
          <stop offset="50%" stopColor="#a853ba" />
          <stop offset="100%" stopColor="#00D4FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default TurboEdgeGradient;
