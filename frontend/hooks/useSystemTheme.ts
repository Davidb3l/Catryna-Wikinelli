import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';

/**
 * Tracks the OS light/dark preference, and keeps tracking it.
 *
 * The viewer read `matchMedia(...).matches` once inside a memo keyed on the
 * user's own preferences, with no `change` listener anywhere in the app. So the
 * `system` mode consulted the system exactly once per page load: flipping macOS
 * between light and dark left the viewer on whichever mode it started in until
 * a reload or an unrelated pref change. A setting named "system" has to follow
 * the system.
 *
 * Lives in its own module so it can be tested against a stub `matchMedia` —
 * the DevTools colour-scheme emulation used for visual QA changes what the
 * query MATCHES without dispatching a `change` event, so it cannot exercise the
 * listener that is the whole point of this hook.
 *
 * Degrades to `false` where `matchMedia` is missing (older happy-dom, SSR).
 */
export const useSystemPrefersDark = (): boolean => {
  // `?.` after the CALL too, so this agrees with the effect's `if (!query)`
  // guard below. Without it, a `matchMedia` that exists but returns undefined
  // throws during render — which the effect handles and the initializer did not.
  const [prefersDark, setPrefersDark] = useState(
    () => globalThis.matchMedia?.(QUERY)?.matches ?? false,
  );

  useEffect(() => {
    const query = globalThis.matchMedia?.(QUERY);
    if (!query) return;

    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    query.addEventListener('change', onChange);

    // Re-read on mount: the OS can change between the initial state
    // computation and this effect running.
    setPrefersDark(query.matches);

    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefersDark;
};
