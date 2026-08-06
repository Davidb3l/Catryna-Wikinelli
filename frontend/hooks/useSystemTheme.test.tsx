/**
 * The `system` theme mode has to keep following the system.
 *
 * It used to read `matchMedia(...).matches` exactly once per page load, with no
 * `change` listener anywhere in the app, so flipping the OS between light and
 * dark did nothing until a reload. The bug was invisible to the usual browser
 * QA pass because DevTools colour-scheme emulation changes what the query
 * matches WITHOUT dispatching `change` — the very event the fix depends on.
 * Hence a stub that can dispatch it on demand.
 */
// MUST come first: registers the DOM before react-dom/client is imported.
import '../happydom';

import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import { useSystemPrefersDark } from './useSystemTheme';

/** A controllable MediaQueryList: flip it and it notifies, like a real OS change. */
const installMatchMedia = (initial: boolean) => {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const query = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listeners.delete(fn); },
  };
  const original = globalThis.matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = () => query;
  return {
    query,
    listenerCount: () => listeners.size,
    /** Simulate the OS switching appearance. */
    flipTo(matches: boolean) {
      query.matches = matches;
      for (const fn of listeners) fn({ matches });
    },
    restore() { (globalThis as { matchMedia?: unknown }).matchMedia = original; },
  };
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let media: ReturnType<typeof installMatchMedia> | null = null;

const render = (ui: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(ui); });
};

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
  media?.restore();
  media = null;
});

const Probe: React.FC = () => {
  const prefersDark = useSystemPrefersDark();
  return React.createElement('span', { 'data-testid': 'v' }, prefersDark ? 'dark' : 'light');
};
const shown = () => host?.querySelector('[data-testid="v"]')?.textContent;

describe('useSystemPrefersDark', () => {
  test('reports the OS preference on first render', () => {
    media = installMatchMedia(true);
    render(React.createElement(Probe));
    expect(shown()).toBe('dark');
  });

  test('FOLLOWS the OS when it changes after mount', () => {
    // The actual regression. Before the fix this stayed on the mount-time value.
    media = installMatchMedia(false);
    render(React.createElement(Probe));
    expect(shown()).toBe('light');

    act(() => { media!.flipTo(true); });
    expect(shown()).toBe('dark');

    act(() => { media!.flipTo(false); });
    expect(shown()).toBe('light');
  });

  test('unsubscribes on unmount, so it cannot leak or set state after teardown', () => {
    media = installMatchMedia(false);
    render(React.createElement(Probe));
    expect(media.listenerCount()).toBe(1);

    act(() => { root!.unmount(); });
    root = null;
    expect(media.listenerCount()).toBe(0);
  });

  test('degrades to light where matchMedia is unavailable', () => {
    const original = globalThis.matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
    try {
      render(React.createElement(Probe));
      expect(shown()).toBe('light');
    } finally {
      (globalThis as { matchMedia?: unknown }).matchMedia = original;
    }
  });
});
