/**
 * The fabricated-data guard.
 *
 * This viewer once displayed an 84% health score, 42 total pages, 12 missing
 * items and four filenames that did not exist in the repo — all literals, with
 * no API call behind any of it. It was reachable from the UI and read as a
 * genuine report. Nothing caught it; a human reading the source did.
 *
 * These tests encode the property that would have: **with no data, the trust
 * surface displays no numbers.** A metric that appears when the API returned
 * nothing can only have come from a literal in the source.
 *
 * That is a narrower claim than "no component ever lies", but it is the exact
 * failure mode that occurred, and it is mechanically checkable.
 */
// MUST come first: registers the DOM before react-dom/client is imported.
import '../happydom';

import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import { CoverageView, DocTrust, StatCard, VerifiedBadge, CoverageTrendChart } from './Trust';
import type { CoverageResponse, CoverageTrendResponse, DriftResponse } from '../types';

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

/**
 * Render a node and return its visible text, with element boundaries preserved.
 *
 * `textContent` concatenates adjacent nodes, so a card showing 5 next to a card
 * showing 4 reads as "54" — which made a correct component look like it had
 * invented a number. Joining text nodes with a space keeps the digit check
 * honest.
 */
function render(node: React.ReactNode): string {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));

  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n.textContent?.trim();
      if (t) parts.push(t);
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(host);
  return parts.join(' ');
}

/** Every digit sequence in the rendered text. */
function digitsIn(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

describe('with NO data, nothing numeric is displayed', () => {
  // The load-bearing test. Reintroducing any hardcoded metric into the coverage
  // screen makes this fail, because the literal renders regardless of props.
  test('CoverageView with a failed fetch shows no metrics at all', () => {
    const text = render(
      <CoverageView
        onClose={() => {}}
        coverage={null}
        loading={false}
        error="HTTP 500"
        drift={null}
        trend={null}
        trendLoading={false}
      />,
    );

    expect(text).toContain('Coverage unavailable');
    expect(digitsIn(text)).toEqual([]);
    // The specific fabrications that were once here.
    for (const ghost of ['84', '42', '12', 'auth-service', 'user-controller', 'database-layer']) {
      expect(text).not.toContain(ghost);
    }
  });

  test('CoverageView while loading shows no metrics either', () => {
    const text = render(
      <CoverageView
        onClose={() => {}}
        coverage={null}
        loading={true}
        error={null}
        drift={null}
        trend={null}
        trendLoading={true}
      />,
    );
    expect(digitsIn(text)).toEqual([]);
  });

  test('a null drift status renders no badge — absence is not "verified"', () => {
    // Failing to ask is not a clean bill of health. A doc with no anchors, or an
    // unreachable /api/drift, must not paint a green dot.
    expect(render(<DocTrust status={null} />)).toBe('');
    expect(render(<VerifiedBadge status={null} compact />)).toBe('');
  });

  test('an empty trend renders a plain explanation, not an empty chart with axis numbers', () => {
    const empty: CoverageTrendResponse = { samples: [], totalCommits: 0, sampled: false };
    const text = render(<CoverageTrendChart trend={empty} />);
    expect(text).toContain('Not enough history');
    expect(digitsIn(text)).toEqual([]);
  });
});

describe('with real data, the numbers shown are exactly the numbers given', () => {
  const coverage: CoverageResponse = {
    totalModules: 7,
    documentedModules: 3,
    coveragePercent: 43,
    totalDocs: 5,
    anchoringDocs: 4,
    brokenAnchors: [],
    undocumented: [{ filePath: 'src/only.ts', name: 'only.ts', lastModified: 0 }],
    totalUndocumented: 1,
    generatedAt: 0,
  };

  test('CoverageView reflects its props and invents nothing', () => {
    const text = render(
      <CoverageView
        onClose={() => {}}
        coverage={coverage}
        loading={false}
        error={null}
        drift={null}
        trend={null}
        trendLoading={false}
      />,
    );

    expect(text).toContain('43%');
    expect(text).toContain('3 of 7 modules anchored');
    expect(text).toContain('src/only.ts');

    // Every number on screen must trace to the props. This is what makes a
    // newly-hardcoded metric fail rather than merely look odd.
    const allowed = new Set(['43', '3', '7', '5', '4', '1', '0']);
    for (const d of digitsIn(text)) {
      expect(allowed.has(d)).toBe(true);
    }
  });

  test('the doc-trust breakdown reflects the drift summary it is given', () => {
    const drift: DriftResponse = {
      gitRepo: true,
      head: 'abc1234',
      docs: {},
      summary: { clean: 9, drifted: 2, broken: 1, unverified: 6 },
    };
    const text = render(
      <CoverageView
        onClose={() => {}}
        coverage={coverage}
        loading={false}
        error={null}
        drift={drift}
        trend={null}
        trendLoading={false}
      />,
    );
    expect(text).toContain('9 verified');
    expect(text).toContain('2 stale');
    expect(text).toContain('1 broken');
    expect(text).toContain('6 unverified');
  });

  test('a non-git repo shows no doc-trust numbers', () => {
    const drift: DriftResponse = {
      gitRepo: false,
      head: null,
      error: 'not a git repository',
      docs: {},
      summary: { clean: 0, drifted: 0, broken: 0, unverified: 0 },
    };
    const text = render(
      <CoverageView
        onClose={() => {}}
        coverage={null}
        loading={false}
        error="unavailable"
        drift={drift}
        trend={null}
        trendLoading={false}
      />,
    );
    expect(text).not.toContain('verified');
    expect(digitsIn(text)).toEqual([]);
  });
});

describe('StatCard is a dumb renderer', () => {
  test('it shows only what it is handed', () => {
    const text = render(<StatCard label="Coverage" value="43%" hint="3 of 7" />);
    expect(text).toContain('Coverage');
    expect(text).toContain('43%');
    expect(text).toContain('3 of 7');
    expect(digitsIn(text).sort()).toEqual(['3', '43', '7']);
  });
});
