import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

/**
 * THE MERMAID BOUNDARY.
 *
 * Everything that touches the `mermaid` package lives in this file and nothing
 * else imports it, so Rolldown can put mermaid — and the cytoscape, katex and
 * per-diagram-type chunks it drags in behind it — in a chunk that is fetched
 * only when a doc actually contains a mermaid diagram. `App.tsx` reaches it
 * through `React.lazy`, never through a static import.
 *
 * Two rules keep that boundary intact:
 *  - `initMermaid` must stay here. It used to run at App.tsx module scope, which
 *    pinned mermaid into the entry chunk for every page view including the ones
 *    with no diagram at all.
 *  - the caller passes a resolved `isDark`, not a theme name. The theming still
 *    re-runs on every theme change (see the effect below) — it just no longer
 *    needs App.tsx to hold a reference to mermaid to do it.
 */

// Initialize mermaid with Turbo Flow inspired theme
const initMermaid = (isDark: boolean) => {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
      padding: 20,
      nodeSpacing: 50,
      rankSpacing: 60,
    },
    themeVariables: isDark ? {
      // Dark mode - Turbo Flow inspired
      fontSize: '13px',
      fontFamily: '"JetBrains Mono", monospace',
      primaryColor: '#1a1a2e',
      primaryTextColor: '#f3f4f6',
      primaryBorderColor: '#a853ba',
      lineColor: '#a853ba',
      secondaryColor: '#16213e',
      tertiaryColor: '#111111',
      background: '#111111',
      mainBkg: '#1a1a2e',
      secondBkg: '#16213e',
      clusterBkg: '#16213e',
      clusterBorder: '#a853ba',
      titleColor: '#f3f4f6',
      edgeLabelBackground: '#111111',
      nodeTextColor: '#f3f4f6',
      actorBorder: '#a853ba',
      actorBkg: '#1a1a2e',
      actorTextColor: '#f3f4f6',
      signalColor: '#a853ba',
      signalTextColor: '#f3f4f6',
    } : {
      // Light mode - Stripe inspired with accent colors
      fontSize: '13px',
      fontFamily: '"JetBrains Mono", monospace',
      primaryColor: '#F6F9FC',
      primaryTextColor: '#0A2540',
      primaryBorderColor: '#635BFF',
      lineColor: '#635BFF',
      secondaryColor: '#FFFFFF',
      tertiaryColor: '#F6F9FC',
      background: '#FFFFFF',
      mainBkg: '#F6F9FC',
      secondBkg: '#FFFFFF',
      clusterBkg: '#F6F9FC',
      clusterBorder: '#635BFF',
      titleColor: '#0A2540',
      edgeLabelBackground: '#FFFFFF',
      nodeTextColor: '#0A2540',
      actorBorder: '#635BFF',
      actorBkg: '#F6F9FC',
      actorTextColor: '#0A2540',
      signalColor: '#635BFF',
      signalTextColor: '#0A2540',
    },
  });
};

// Mermaid diagram renderer component
const MermaidDiagram: React.FC<{
  chart: string;
  isDark: boolean;
  /** Fired once an SVG is on screen. The caller uses it to enable Expand — the
   *  zoom modal is a one-shot DOM clone, so expanding before this would copy the
   *  loading spinner into a modal that never resolves. */
  onRendered?: () => void;
}> = ({ chart, isDark, onRendered }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the callback's identity cannot re-trigger the render effect.
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(() => {
    const renderChart = async () => {
      if (!chart || !containerRef.current) return;
      try {
        // Re-initialize mermaid with correct theme before rendering. `isDark` is
        // a dep of this effect, so a theme switch re-themes AND re-renders every
        // diagram on screen — the behaviour the old App.tsx theme effect had,
        // without mermaid being reachable from App.tsx.
        initMermaid(isDark);

        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        let { svg: renderedSvg } = await mermaid.render(id, chart);

        // Inject gradient definition for turbo-style edges
        const gradientDef = `
          <defs>
            <linearGradient id="mermaid-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#e92a67" />
              <stop offset="50%" stop-color="#a853ba" />
              <stop offset="100%" stop-color="#2a8af6" />
            </linearGradient>
          </defs>
        `;

        // Insert gradient after opening svg tag
        renderedSvg = renderedSvg.replace(/<svg([^>]*)>/, `<svg$1>${gradientDef}`);

        // Post-process SVG to fix edge label backgrounds for the current theme
        // Target edgeLabel rect elements and set correct fill
        const labelBgColor = isDark ? '#1a1a2e' : '#ffffff';
        const labelTextColor = isDark ? '#f3f4f6' : '#0A2540';

        // Fix edgeLabel rect backgrounds (Mermaid sets inline styles)
        renderedSvg = renderedSvg.replace(
          /<g[^>]*class="[^"]*edgeLabel[^"]*"[^>]*>[\s\S]*?<rect[^>]*>/g,
          (match) => match.replace(/fill="[^"]*"/, `fill="${labelBgColor}"`)
        );

        // Also handle foreignObject backgrounds in edge labels
        renderedSvg = renderedSvg.replace(
          /(<g[^>]*class="[^"]*edgeLabel[^"]*"[^>]*>[\s\S]*?<foreignObject[^>]*>[\s\S]*?<div[^>]*style=")([^"]*)(")/g,
          (match, before, style, after) => {
            const newStyle = style.replace(/background[^;]*;?/g, '') + `background:${labelBgColor};color:${labelTextColor};`;
            return before + newStyle + after;
          }
        );

        setSvg(renderedSvg);
        setError(null);
        onRenderedRef.current?.();
      } catch (e) {
        setError(String(e));
        console.error('Mermaid render error:', e);
      }
    };
    renderChart();
  }, [chart, isDark]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg text-red-600 dark:text-red-400 text-sm">
        <div className="font-bold mb-2">Diagram Error</div>
        <pre className="text-xs overflow-auto">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container w-full [&_svg]:w-full [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:min-h-[200px] sm:[&_svg]:min-h-[300px]"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidDiagram;
