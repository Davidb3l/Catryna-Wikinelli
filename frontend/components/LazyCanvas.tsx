import React from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

/**
 * Suspense + error boundary for one lazily-loaded canvas.
 *
 * The error boundary half is not optional. `React.lazy` re-throws a failed
 * `import()` during render, and the only boundary above these canvases is the
 * app-wide one in `index.tsx` — so a single un-fetchable chunk replaced the
 * ENTIRE viewer (sidebar, nav, the prose the reader was in the middle of) with
 * the full-screen crash card. One missing diagram is not an app-wide failure,
 * and a doc is still worth reading without its diagram.
 *
 * Triggers are ordinary, not exotic: a dev server restart, a deploy that
 * rotates content hashes while a tab is open, or a flaky connection during the
 * ~1 MiB mermaid graph or the ~936 KiB tldraw chunk.
 *
 * **Recovery is a page reload, and the button says so.** React caches the
 * rejected promise on the lazy component for the life of the page
 * (`lazyInitializer` sets `_status = REJECTED` and thereafter re-throws the
 * stored error without retrying), so a "Try again" that merely cleared this
 * boundary's state would re-throw the same error immediately. This project has
 * a standing rule against controls that claim to do something they cannot —
 * see the removed Save button in `frontend/overview`. So: reload, which works.
 */

/** Shared loading state. Same spinner vocabulary as `components/Trust.tsx`. */
export const CanvasLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="h-full w-full flex items-center justify-center py-10">
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-zinc-500"
    >
      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {label}
    </div>
  </div>
);

interface BoundaryProps {
  /** Human name of what failed, e.g. "diagram". Used in the message. */
  what: string;
  children: React.ReactNode;
}

class LazyErrorBoundary extends React.Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Catryna viewer: lazy chunk failed to load:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="max-w-sm w-full p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
              This {this.props.what} could not be loaded
            </div>
          </div>
          <p className="text-xs text-amber-900/90 dark:text-amber-300/90 mb-3">
            The rest of the page is fine, and your <code className="font-mono">.docs/</code> files
            are untouched. This usually means the viewer was rebuilt or restarted while this tab
            was open.
          </p>
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-amber-900/80 dark:text-amber-300/80 mb-3 max-h-20 overflow-auto">
            {error.message || String(error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Wrap every lazy canvas in this rather than a bare `<React.Suspense>`, so the
 * loading state and the failure state can never drift apart.
 */
export const LazyCanvas: React.FC<{ what: string; children: React.ReactNode }> = ({ what, children }) => (
  <LazyErrorBoundary what={what}>
    <React.Suspense fallback={<CanvasLoading label={`Loading ${what}…`} />}>
      {children}
    </React.Suspense>
  </LazyErrorBoundary>
);
