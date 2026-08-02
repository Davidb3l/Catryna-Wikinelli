import React from 'react';
import { X, BarChart3, Terminal, Loader2, AlertCircle } from 'lucide-react';
import type {
  CoverageResponse,
  CoverageTrendResponse,
  DocDrift,
  DriftResponse,
  DriftStatus,
} from '../types';

/**
 * Presentational components for the Phase 2 trust surface.
 *
 * Extracted out of App.tsx so they can be RENDERED IN TESTS. Nothing here
 * fetches; every one takes its data as props. That is deliberate — see
 * `CoverageView` below and `trust.test.tsx`, which asserts that with no data
 * these components display no numbers at all.
 */

/** Local button, matching App.tsx's styling contract for these views. */
const Button: React.FC<{
  variant?: 'ghost' | 'outline' | 'accent';
  onClick?: () => void;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}> = ({ variant = 'ghost', onClick, className = '', title, children }) => {
  const base = 'inline-flex items-center gap-1.5 rounded-lg font-bold transition-colors';
  const tone =
    variant === 'accent'
      ? 'bg-accent text-white hover:opacity-90'
      : variant === 'outline'
        ? 'border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900'
        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800';
  return (
    <button title={title} onClick={onClick} className={`${base} ${tone} ${className}`}>
      {children}
    </button>
  );
};

/**
 * Verified badge (PRODUCT_ROADMAP Phase 2).
 *
 * Green = verified at HEAD, amber = anchored code changed since, red = anchors
 * broken, grey = never verified. `null` means the viewer could not determine a
 * status (no /api/drift, or not a git repo) — it renders as "unknown" rather
 * than as verified, because failing to ask is not a clean bill of health.
 */
const DRIFT_BADGE: Record<string, { label: string; title: string; cls: string; dot: string }> = {
  clean: {
    label: 'Verified',
    title: 'Verified: anchored code is unchanged since this doc was last checked.',
    cls: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/60 border-green-200 dark:border-green-900',
    dot: 'bg-green-500',
  },
  drifted: {
    label: 'Stale',
    title: 'Stale: anchored code has changed since this doc was last verified.',
    cls: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
  },
  broken: {
    label: 'Broken',
    title: 'Broken: a file this doc anchors no longer exists.',
    cls: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-950/60 border-red-200 dark:border-red-900',
    dot: 'bg-red-500',
  },
  unverified: {
    label: 'Unverified',
    title: 'Unverified: this doc has no drift baseline and has never been checked against the code.',
    cls: 'text-zinc-600 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700',
    dot: 'bg-zinc-400',
  },
  unknown: {
    label: 'Unknown',
    title: 'Unknown: drift could not be computed (no git repository, or this doc anchors no code).',
    cls: 'text-zinc-500 bg-transparent border-dashed border-zinc-300 dark:border-zinc-700',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
  },
};

export const VerifiedBadge: React.FC<{ status: DriftStatus | null; compact?: boolean }> = ({ status, compact }) => {
  const b = DRIFT_BADGE[status ?? 'unknown'];
  if (compact) {
    return <span title={b.title} className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${b.dot}`} />;
  }
  return (
    <span
      title={b.title}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${b.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} />
      {b.label}
    </span>
  );
};

/**
 * The per-doc trust line under the title: the badge, plus what the verdict is
 * actually based on. A badge alone tells a reader a doc is stale; naming the
 * changed files tells them what to go re-read.
 */
export const DocTrust: React.FC<{ status: DriftStatus | null; detail?: DocDrift }> = ({ status, detail }) => {
  if (!status) return null;
  const files = status === 'broken' ? (detail?.brokenFiles ?? []) : (detail?.changedFiles ?? []);
  const noun = status === 'broken' ? 'missing' : 'changed';
  return (
    <div className="mb-6 sm:mb-8 lg:mb-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
      <VerifiedBadge status={status} />
      {detail?.verifiedCommit && (
        <span>baseline <code className="font-mono">{detail.verifiedCommit.slice(0, 7)}</code></span>
      )}
      {files.length > 0 && (
        <span className="min-w-0">
          {files.length} {noun}:{' '}
          <span className="font-mono">{files.slice(0, 3).join(', ')}</span>
          {files.length > 3 && ` +${files.length - 3} more`}
        </span>
      )}
    </div>
  );
};

export const StatCard: React.FC<{ label: string; value: React.ReactNode; tone?: string; hint?: string }> = ({
  label, value, tone = 'text-zinc-900 dark:text-white', hint,
}) => (
  <div className="p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-900 rounded-xl sm:rounded-2xl border border-zinc-100 dark:border-zinc-800">
    <div className="text-[10px] sm:text-xs text-zinc-400 font-bold uppercase mb-1.5 sm:mb-2">{label}</div>
    <div className={`text-3xl sm:text-4xl font-black ${tone}`}>{value}</div>
    {hint && <div className="text-[10px] sm:text-xs text-zinc-400 mt-1">{hint}</div>}
  </div>
);

/**
 * Coverage over time. Plain inline SVG — a chart library is a lot of bytes for
 * one line, and this view is the only consumer.
 *
 * The y-axis is pinned to 0–100 rather than fitted to the data: an
 * auto-scaled axis makes a 2-point wobble look like a collapse, and this chart
 * exists to show whether documentation is keeping pace, not to dramatize noise.
 */
export const CoverageTrendChart: React.FC<{ trend: CoverageTrendResponse }> = ({ trend }) => {
  const samples = trend.samples;
  if (samples.length < 2) {
    return (
      <div className="text-xs text-zinc-500">
        Not enough history yet — the trend needs at least two commits.
      </div>
    );
  }

  const W = 720, H = 140, PAD_L = 28, PAD_B = 18, PAD_T = 8;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_B - PAD_T;

  // x is scaled by TIME, not by commit index. Index-uniform spacing under
  // date labels is a quietly false picture: on this repo a six-month gap and a
  // 90-second gap rendered as identical widths, so a reader asking "when did
  // our docs fall behind?" read the answer off the wrong part of the chart.
  // Falls back to index spacing only when every sample shares a timestamp,
  // where a time axis has no meaning.
  const t0 = samples[0].timestamp;
  const span = samples[samples.length - 1].timestamp - t0;
  const x = (i: number) =>
    PAD_L + (span > 0 ? (samples[i].timestamp - t0) / span : i / (samples.length - 1)) * plotW;
  const y = (pct: number) => PAD_T + (1 - pct / 100) * plotH;

  const line = samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.coveragePercent).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(samples.length - 1).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`;

  const fmt = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const first = samples[0], last = samples[samples.length - 1];
  const delta = last.coveragePercent - first.coveragePercent;

  // Biggest drop between consecutive samples — the thing worth looking at.
  let worst = { drop: 0, at: -1 };
  for (let i = 1; i < samples.length; i++) {
    const drop = samples[i - 1].coveragePercent - samples[i].coveragePercent;
    if (drop > worst.drop) worst = { drop, at: i };
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label={`Documentation coverage from ${fmt(first.timestamp)} to ${fmt(last.timestamp)}`}>
        {[0, 50, 100].map(g => (
          <g key={g}>
            <line x1={PAD_L} x2={W - 8} y1={y(g)} y2={y(g)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(g) + 3} textAnchor="end" className="fill-zinc-400" style={{ fontSize: 8 }}>{g}</text>
          </g>
        ))}
        <path d={area} className="fill-indigo-500/10" />
        <path d={line} className="stroke-indigo-500" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {worst.at > 0 && worst.drop >= 5 && (
          <circle cx={x(worst.at)} cy={y(samples[worst.at].coveragePercent)} r={3.5}
                  className="fill-amber-500 stroke-white dark:stroke-zinc-950" strokeWidth={1.5}>
            <title>{`−${worst.drop}% at ${samples[worst.at].commit.slice(0, 7)} (${fmt(samples[worst.at].timestamp)})`}</title>
          </circle>
        )}
        {samples.map((s, i) => (
          <circle key={s.commit} cx={x(i)} cy={y(s.coveragePercent)} r={2} className="fill-indigo-500">
            <title>{`${fmt(s.timestamp)} · ${s.commit.slice(0, 7)} · ${s.coveragePercent}% (${s.documentedModules}/${s.totalModules} modules, ${s.totalDocs} docs)`}</title>
          </circle>
        ))}
        <text x={PAD_L} y={H - 4} className="fill-zinc-400" style={{ fontSize: 8 }}>{fmt(first.timestamp)}</text>
        <text x={W - 8} y={H - 4} textAnchor="end" className="fill-zinc-400" style={{ fontSize: 8 }}>{fmt(last.timestamp)}</text>
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-zinc-400 mt-1">
        <span>
          {delta === 0 ? 'Flat' : delta > 0 ? `Up ${delta} pts` : `Down ${Math.abs(delta)} pts`} over {samples.length} points
        </span>
        {worst.drop >= 5 && (
          <span className="text-amber-600 dark:text-amber-500">
            {/* When the series is downsampled, consecutive samples skip commits,
                so naming one SHA blames it for a drop up to N commits wide.
                Report the bracketing range instead of a false attribution. */}
            Largest drop −{worst.drop}%{' '}
            {trend.sampled
              ? `between ${samples[worst.at - 1].commit.slice(0, 7)} and ${samples[worst.at].commit.slice(0, 7)}`
              : `at ${samples[worst.at].commit.slice(0, 7)}`}
          </span>
        )}
        {trend.sampled && <span>sampled {samples.length} of {trend.totalCommits} commits</span>}
      </div>
    </div>
  );
};

/**
 * The coverage screen, as a PURE VIEW over data it is given.
 *
 * This split is the safeguard, not just tidiness. The screen once rendered a
 * hardcoded 84% health score, 42 pages, 12 missing and four filenames that did
 * not exist — with no API call behind any of it. A component that fetches its
 * own data can always be edited to skip the fetch and keep the number; a
 * component that only receives data structurally cannot show something it was
 * not given. `CoverageReport` below is the thin hook wiring.
 */
export const CoverageView: React.FC<{
  onClose: () => void;
  coverage: CoverageResponse | null;
  loading: boolean;
  error: string | null;
  drift: DriftResponse | null;
  trend: CoverageTrendResponse | null;
  trendLoading: boolean;
}> = ({ onClose, coverage, loading, error, drift, trend, trendLoading }) => {

  return (
    <div className="fixed inset-0 z-[160] bg-white dark:bg-zinc-950 flex flex-col animate-in fade-in duration-300">
      <header className="h-12 sm:h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3"><Button variant="ghost" onClick={onClose} className="p-1"><X size={20} /></Button><h2 className="font-bold flex items-center gap-2 text-sm sm:text-base"><BarChart3 size={18} /> <span className="hidden sm:inline">Documentation</span> Coverage</h2></div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-12 max-w-5xl mx-auto w-full">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> Scanning source files…</div>
        )}

        {!loading && (error || !coverage) && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Coverage unavailable</div>
              <div className="mt-1 text-xs">
                The dev server did not answer <code>/api/coverage</code>. No numbers are shown rather than made-up ones.
              </div>
            </div>
          </div>
        )}

        {!loading && coverage && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-8 sm:mb-12">
              <StatCard
                label="Coverage"
                value={`${coverage.coveragePercent}%`}
                tone="text-indigo-600"
                hint={`${coverage.documentedModules} of ${coverage.totalModules} modules anchored`}
              />
              <StatCard
                label="Docs"
                value={coverage.totalDocs}
                hint={`${coverage.anchoringDocs} anchor code`}
              />
              <StatCard
                label="Undocumented"
                value={coverage.totalUndocumented}
                tone={coverage.totalUndocumented > 0 ? 'text-amber-500' : 'text-green-600'}
                hint={coverage.totalUndocumented > coverage.undocumented.length
                  ? `showing first ${coverage.undocumented.length}`
                  : 'complete list below'}
              />
            </div>

            <div className="mb-8">
              <div className="text-xs font-bold uppercase text-zinc-400 mb-2">Coverage over time</div>
              {/* The trend walks git history (two reads per sample), so it can lag
                  the rest of the dashboard on a long history — say so rather than
                  leaving a blank that looks like "no data". */}
              {trendLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 h-[140px]">
                  <Loader2 size={14} className="animate-spin" /> Reading coverage from git history…
                </div>
              )}
              {!trendLoading && trend && !trend.error && trend.samples.length > 0 && (
                <CoverageTrendChart trend={trend} />
              )}
              {!trendLoading && (!trend || trend.error) && (
                <div className="text-xs text-zinc-500">
                  Trend unavailable{trend?.error ? ` — ${trend.error}` : ''}. It is derived from git history, so it needs a git repository.
                </div>
              )}
            </div>

            {drift && drift.gitRepo && (
              <div className="mb-8 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-400 font-bold uppercase tracking-wide">Doc trust</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{drift.summary.clean} verified</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />{drift.summary.drifted} stale</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />{drift.summary.broken} broken</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />{drift.summary.unverified} unverified</span>
              </div>
            )}

            {coverage.brokenAnchors.length > 0 && (
              <div className="mb-8 p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40">
                <div className="text-xs font-bold uppercase text-red-700 dark:text-red-400 mb-2">
                  Broken anchors ({coverage.brokenAnchors.length})
                </div>
                <div className="space-y-1">
                  {coverage.brokenAnchors.map(f => (
                    <div key={f} className="text-xs font-mono text-red-800 dark:text-red-300">{f}</div>
                  ))}
                </div>
                <div className="text-[10px] text-red-700/70 dark:text-red-400/70 mt-2">
                  A doc anchors these paths, but they are not on disk.
                </div>
              </div>
            )}

            <div className="text-xs font-bold uppercase text-zinc-400 mb-3">
              Undocumented modules{coverage.totalUndocumented > coverage.undocumented.length && ` (first ${coverage.undocumented.length} of ${coverage.totalUndocumented})`}
            </div>
            <div className="space-y-2 sm:space-y-3">
              {coverage.undocumented.length === 0 && (
                <div className="text-sm text-zinc-500">Every source module is anchored by a doc.</div>
              )}
              {coverage.undocumented.map(m => (
                <div key={m.filePath} className="p-3 sm:p-4 bg-white dark:bg-zinc-900/50 rounded-lg sm:rounded-xl border border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <Terminal size={14} className="text-zinc-400 shrink-0 sm:w-4 sm:h-4" />
                    <span className="text-xs sm:text-sm font-medium truncate font-mono" title={m.filePath}>{m.filePath}</span>
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold shrink-0 text-amber-500">Undocumented</span>
                </div>
              ))}
            </div>

            <div className="mt-8 text-[10px] text-zinc-400">
              Computed from source on disk and <code>.docs/_index.json</code> — the same engine as
              {' '}<code>get_doc_coverage</code> and <code>catryna drift</code>.
            </div>
          </>
        )}
      </div>
    </div>
  );
};
