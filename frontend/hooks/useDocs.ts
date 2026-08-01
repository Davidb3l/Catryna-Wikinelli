import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Document,
  NavItem,
  Block,
  DocAnchor,
  DocVerification,
  VerificationStatus,
  DriftStatus,
  DriftResponse,
  DocDrift,
  CoverageResponse,
  CoverageTrendResponse,
} from '../types';

/**
 * Doc metadata as served by /api/docs. Mirrors `DocMetadata` in src/storage.ts —
 * keep the two in sync. Notably this INCLUDES the drift fields (`anchors`,
 * `verifiedCommit`, `verifiedAt`, `driftSuspect*`): without them the viewer
 * cannot tell a verified doc from one the code has outgrown.
 *
 * The dev API serves `_index.json` verbatim, so a legacy index written before a
 * field existed will simply omit it. `normalizeDocMetadata` fills those in with
 * the same defaults the backend uses on read, which is why every field here is
 * required — consumers never have to guard.
 */
export interface DocMetadata {
  id: string;
  path: string;
  title: string;
  tags: string[];
  relatedFiles: string[];
  anchors: DocAnchor[];
  evidence: string[];
  refs: string[];
  verifiedCommit: string;
  verifiedAt: string;
  driftSuspectSince: string;
  driftSuspectReason: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

/**
 * A doc entry straight off the wire: `path` is the only field we can rely on,
 * since the dev API serves whatever `_index.json` holds.
 */
type RawDocMetadata = Partial<DocMetadata> & { path: string };

/** Drop entries the rest of the pipeline would choke on (every read splits `path`). */
function isUsable(doc: Partial<DocMetadata>): doc is RawDocMetadata {
  return typeof doc?.path === 'string' && doc.path.length > 0;
}

/** Fill in fields a legacy index may omit, matching src/storage.ts defaults. */
function normalizeDocMetadata(doc: RawDocMetadata): DocMetadata {
  return {
    id: doc.id ?? doc.path,
    path: doc.path,
    title: doc.title ?? '',
    tags: doc.tags ?? [],
    relatedFiles: doc.relatedFiles ?? [],
    anchors: doc.anchors ?? [],
    evidence: doc.evidence ?? [],
    refs: doc.refs ?? [],
    verifiedCommit: doc.verifiedCommit ?? '',
    verifiedAt: doc.verifiedAt ?? '',
    driftSuspectSince: doc.driftSuspectSince ?? '',
    driftSuspectReason: doc.driftSuspectReason ?? '',
    createdAt: doc.createdAt ?? 0,
    updatedAt: doc.updatedAt ?? 0,
    createdBy: doc.createdBy ?? '',
  };
}

/**
 * Normalizers for the trust endpoints.
 *
 * `useDocsList` already ran everything through `normalizeDocMetadata`; the three
 * trust hooks assigned `await res.json()` straight to state. A malformed 200 —
 * an older/newer dev server, a hand-edited index — therefore reached the
 * renderer unchecked, where `new Date(undefined).toISOString()` throws a
 * RangeError and, with no error boundary, unmounts the whole app. `res.ok` is
 * true in that case, so the "unavailable" branch never fires.
 *
 * These coerce to a usable shape and return null when the payload is not
 * recognisable, which routes to the existing "unavailable" UI.
 */
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeDrift(raw: unknown): DriftResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const docs: Record<string, DocDrift> = {};
  if (r.docs && typeof r.docs === 'object') {
    for (const [k, v] of Object.entries(r.docs as Record<string, any>)) {
      const status = v?.status;
      // Only the four real verdicts pass; anything else is not a verdict and
      // must not be rendered as one.
      if (status !== 'clean' && status !== 'drifted' && status !== 'broken' && status !== 'unverified') continue;
      docs[k] = {
        status,
        verifiedCommit: str(v.verifiedCommit),
        changedFiles: arr<string>(v.changedFiles).filter(f => typeof f === 'string'),
        ...(Array.isArray(v.brokenFiles) ? { brokenFiles: v.brokenFiles.filter((f: unknown) => typeof f === 'string') } : {}),
      };
    }
  }
  const s = r.summary && typeof r.summary === 'object' ? r.summary : {};
  return {
    gitRepo: r.gitRepo === true,
    head: typeof r.head === 'string' ? r.head : null,
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
    docs,
    summary: {
      clean: num(s.clean), drifted: num(s.drifted), broken: num(s.broken), unverified: num(s.unverified),
    },
  };
}

export function normalizeCoverage(raw: unknown): CoverageResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (typeof r.totalModules !== 'number') return null; // not a coverage payload
  return {
    totalModules: num(r.totalModules),
    documentedModules: num(r.documentedModules),
    coveragePercent: num(r.coveragePercent),
    totalDocs: num(r.totalDocs),
    anchoringDocs: num(r.anchoringDocs),
    brokenAnchors: arr<string>(r.brokenAnchors).filter(f => typeof f === 'string'),
    undocumented: arr<any>(r.undocumented)
      .filter(m => m && typeof m.filePath === 'string')
      .map(m => ({ filePath: m.filePath, name: str(m.name, m.filePath), lastModified: num(m.lastModified) })),
    totalUndocumented: num(r.totalUndocumented),
    generatedAt: num(r.generatedAt),
  };
}

export function normalizeTrend(raw: unknown): CoverageTrendResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  // Drop samples missing the fields the chart dereferences — a sample without a
  // timestamp or commit is what threw RangeError mid-render.
  const samples = arr<any>(r.samples)
    .filter(s => s && typeof s.commit === 'string' && typeof s.timestamp === 'number' && Number.isFinite(s.timestamp))
    .map(s => ({
      commit: s.commit,
      timestamp: s.timestamp,
      coveragePercent: num(s.coveragePercent),
      totalModules: num(s.totalModules),
      documentedModules: num(s.documentedModules),
      totalDocs: num(s.totalDocs),
    }));
  return {
    samples,
    totalCommits: num(r.totalCommits, samples.length),
    sampled: r.sampled === true,
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
  };
}

export function verificationStatus(v: DocVerification | undefined): VerificationStatus {
  if (!v?.verifiedCommit) return 'unverified';
  return v.driftSuspectSince ? 'suspect' : 'verified';
}

function toVerification(doc: DocMetadata): DocVerification {
  return {
    anchors: doc.anchors,
    verifiedCommit: doc.verifiedCommit,
    verifiedAt: doc.verifiedAt,
    driftSuspectSince: doc.driftSuspectSince,
    driftSuspectReason: doc.driftSuspectReason,
  };
}

interface DocsIndex {
  version: number;
  docs: RawDocMetadata[];
  lastUpdated: number | null;
}

// The single-doc endpoint spreads the index entry over {path, blocks, raw}. A
// doc missing from the index yields metadata-less fields, hence Partial.
type DocResponse = Partial<DocMetadata> & {
  path: string;
  blocks: Block[];
  raw: string;
};

interface SearchResult {
  results: RawDocMetadata[];
  query: string;
}

// Convert API doc to frontend Document type
function toDocument(doc: DocResponse): Document {
  const meta = normalizeDocMetadata(doc);
  return {
    id: meta.id,
    title: meta.title,
    path: meta.path.split('/'),
    blocks: doc.blocks || [],
    lastUpdated: meta.updatedAt ? new Date(meta.updatedAt).toISOString() : new Date().toISOString(),
    verification: toVerification(meta),
  };
}

// Build nav tree from flat docs list
function buildNavTree(docs: DocMetadata[]): NavItem[] {
  const tree: NavItem[] = [];
  const folders: Record<string, NavItem> = {};

  for (const doc of docs) {
    const parts = doc.path.split('/');
    const fileName = parts.pop() || doc.path;
    const folderPath = parts.join('/');

    // Create file item
    const fileItem: NavItem = {
      id: doc.path,
      title: doc.title || fileName,
      type: 'file',
    };

    if (folderPath) {
      // Create folder if needed
      if (!folders[folderPath]) {
        folders[folderPath] = {
          id: `folder-${folderPath}`,
          title: parts[parts.length - 1] || folderPath,
          type: 'folder',
          children: [],
        };
        tree.push(folders[folderPath]);
      }
      folders[folderPath].children!.push(fileItem);
    } else {
      // Top-level file
      tree.push(fileItem);
    }
  }

  return tree;
}

// Hook to fetch all docs list
export function useDocsList() {
  const [docs, setDocs] = useState<DocMetadata[]>([]);
  const [navItems, setNavItems] = useState<NavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/docs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DocsIndex = await res.json();
      const docs = (data.docs || []).filter(isUsable).map(normalizeDocMetadata);
      setDocs(docs);
      setNavItems(buildNavTree(docs));
    } catch (err) {
      setError(String(err));
      setDocs([]);
      setNavItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  return { docs, navItems, loading, error, refetch: fetchDocs };
}

// Hook to fetch a single doc
export function useDoc(path: string | null) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against out-of-order responses. Without it, clicking a slow doc then
  // a fast one could resolve in the wrong order and leave the slow doc's content
  // on screen — under the *other* doc's verified badge.
  const inFlight = useRef<AbortController | null>(null);

  const fetchDoc = useCallback(async (docPath: string) => {
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${docPath}`, { signal: ctrl.signal });
      if (!res.ok) {
        if (res.status === 404) {
          if (inFlight.current === ctrl) { setDoc(null); setError(`Doc not found: ${docPath}`); }
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: DocResponse = await res.json();
      const document = toDocument(data);
      if (inFlight.current !== ctrl) return document; // superseded — don't render
      setDoc(document);
      return document;
    } catch (err) {
      // A superseded request is not an error to show the user.
      if ((err as Error)?.name === 'AbortError') return null;
      setError(String(err));
      setDoc(null);
      return null;
    } finally {
      if (inFlight.current === ctrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path) {
      fetchDoc(path);
    } else {
      setDoc(null);
    }
    return () => inFlight.current?.abort();
  }, [path, fetchDoc]);

  return { doc, loading, error, refetch: () => path && fetchDoc(path) };
}

// Hook for search
export function useDocsSearch() {
  const [results, setResults] = useState<DocMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setResults([]);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResult = await res.json();
      const results = (data.results || []).filter(isUsable).map(normalizeDocMetadata);
      setResults(results);
      return results;
    } catch (err) {
      setError(String(err));
      setResults([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, error, search };
}

/**
 * Per-doc drift status for the verified badge (PRODUCT_ROADMAP Phase 2).
 *
 * This is the REAL verdict — `GET /api/drift` runs the same git-backed engine as
 * `catryna drift`. It is deliberately not derived from frontmatter: a doc's
 * stored `verifiedCommit` only says which commit it was checked at, never
 * whether the code has moved on since.
 *
 * Degrades quietly. Outside a git repo (or on a dev API that predates the
 * endpoint) `statuses` is empty and every badge renders as unknown — the viewer
 * must not claim docs are verified because it failed to ask.
 */
export function useDrift() {
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDrift = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/drift');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDrift(normalizeDrift(await res.json()));
    } catch {
      setDrift(null);
    } finally {
      lastFetch.current = Date.now();
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrift(); }, [fetchDrift]);

  // Refetch when the window regains focus — the real workflow is "leave the
  // viewer, change code, come back", and drift was otherwise fetched once on
  // mount and never again, so a green badge could outlive the code it describes
  // for a whole session.
  //
  // Throttled: every refetch spawns git subprocesses, and alt-tabbing should not
  // cost anything. Skipped entirely if we already refetched within the window.
  const lastFetch = useRef(0);
  useEffect(() => {
    const MIN_INTERVAL_MS = 30_000;
    const onFocus = () => {
      if (Date.now() - lastFetch.current < MIN_INTERVAL_MS) return;
      lastFetch.current = Date.now();
      fetchDrift();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchDrift]);

  const statusFor = useCallback(
    (path: string): DriftStatus | null => drift?.docs?.[path]?.status ?? null,
    [drift],
  );

  return { drift, loading, statusFor, refetch: fetchDrift };
}

/**
 * Coverage over time, from `GET /api/coverage/trend`.
 *
 * Derived from git history on request — there is no stored series, so the chart
 * is always complete and always current. Costs two git reads per sample, hence
 * the bounded `points`.
 */
export function useCoverageTrend(points = 40) {
  const [trend, setTrend] = useState<CoverageTrendResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrend = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/coverage/trend?points=${points}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTrend(normalizeTrend(await res.json()));
    } catch {
      setTrend(null);
    } finally {
      setLoading(false);
    }
  }, [points]);

  useEffect(() => { fetchTrend(); }, [fetchTrend]);

  return { trend, loading, refetch: fetchTrend };
}

/** Real documentation coverage from `GET /api/coverage`. */
export function useCoverage() {
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/coverage');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCoverage(normalizeCoverage(await res.json()));
    } catch (err) {
      setError(String(err));
      setCoverage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCoverage(); }, [fetchCoverage]);

  return { coverage, loading, error, refetch: fetchCoverage };
}

// Default empty doc for when nothing is selected
export const EMPTY_DOC: Document = {
  id: 'empty',
  title: 'No Document Selected',
  path: [],
  blocks: [
    {
      id: 'empty-1',
      type: 'heading-1',
      content: 'Welcome to Catryna Wikinelli',
    },
    {
      id: 'empty-2',
      type: 'paragraph',
      content: 'Select a document from the sidebar or create a new one using Claude Code.',
    },
    {
      id: 'empty-3',
      type: 'callout',
      content: 'Use the MCP tools (create_doc, update_doc) in Claude Code to create documentation.',
      metadata: { level: 'info' },
    },
  ],
  lastUpdated: new Date().toISOString(),
};
