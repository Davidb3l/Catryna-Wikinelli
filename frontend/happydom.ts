/**
 * Registers a DOM so components can be rendered in tests.
 *
 * Imported directly by component test files rather than wired through a
 * `bunfig.toml` preload, deliberately: a preload only applies when `bun test`
 * runs from the directory holding that config. `bun run check` runs the suite
 * from the repo root, where the preload would not load and every component test
 * would fail on a missing `document`. A gate that only passes from one
 * directory is not a gate.
 *
 * Idempotent, so importing it from several test files is safe.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  GlobalRegistrator.register();
}

// React 19 needs this flag for act() to flush updates synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
