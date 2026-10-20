/**
 * Ambient declarations for values Vite injects at build time.
 *
 * Must live in a file with no imports or exports — inside a module (types.ts)
 * a `declare const` is module-scoped and invisible to the rest of the app.
 */

/** The version from the repo root package.json, injected by vite.config.ts. */
declare const __CATRYNA_VERSION__: string;

/**
 * Side-effect stylesheet imports (`import './index.css'`). TypeScript 6+ checks
 * those specifiers (`noUncheckedSideEffectImports`), and nothing else declares
 * plain `.css` modules here. Vite handles them at build time.
 */
declare module '*.css';
