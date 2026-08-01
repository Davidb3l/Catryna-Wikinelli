import React from 'react';

/**
 * Last-resort boundary around the whole app.
 *
 * Without one, a single render-time throw unmounts the React root and leaves a
 * blank white page — no message, no recovery, nothing telling the user the
 * viewer failed rather than the project being empty. Review found live throw
 * sites reachable from unvalidated API data (`new Date(undefined).toISOString()`
 * in the trend chart, `.slice()` on a missing commit SHA).
 *
 * The hook-level normalizers are the real fix; this is the floor beneath them,
 * for the throw nobody predicted. It shows what broke rather than hiding it —
 * a viewer whose job is surfacing untrustworthy docs should not fail silently.
 *
 * NOTE ON TYPING: this project has no `@types/react`, so `React.Component`'s
 * generics do not flow and `this.props` / `this.setState` are untyped. The
 * members are therefore declared explicitly and recovery is a reload rather
 * than a `setState`, which keeps the file typechecking without adding a
 * dependency or widening the error baseline.
 */
interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  props!: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Keep the detail in the console for whoever is debugging.
    console.error('Catryna viewer crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-zinc-950">
        <div className="max-w-lg w-full p-6 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40">
          <h1 className="text-lg font-black text-red-800 dark:text-red-300 mb-2">
            The viewer hit an error
          </h1>
          <p className="text-sm text-red-800/90 dark:text-red-300/90 mb-4">
            This is a bug in the viewer, not a problem with your documentation. Your
            <code className="font-mono mx-1">.docs/</code> files are untouched — nothing here writes.
          </p>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-red-900 dark:text-red-200 bg-red-100/60 dark:bg-red-950/60 rounded-lg p-3 mb-4 max-h-48 overflow-auto">
            {error.message || String(error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Reload the viewer
          </button>
        </div>
      </div>
    );
  }
}
