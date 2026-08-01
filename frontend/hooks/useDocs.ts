import { useState, useEffect, useCallback } from 'react';
import type {
  Document,
  NavItem,
  Block,
  DocAnchor,
  DocVerification,
  VerificationStatus,
  DriftStatus,
  DriftResponse,
  CoverageResponse,
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

  const fetchDoc = useCallback(async (docPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${docPath}`);
      if (!res.ok) {
        if (res.status === 404) {
          setDoc(null);
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: DocResponse = await res.json();
      const document = toDocument(data);
      setDoc(document);
      return document;
    } catch (err) {
      setError(String(err));
      setDoc(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path) {
      fetchDoc(path);
    } else {
      setDoc(null);
    }
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
      setDrift(await res.json());
    } catch {
      setDrift(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrift(); }, [fetchDrift]);

  const statusFor = useCallback(
    (path: string): DriftStatus | null => drift?.docs?.[path]?.status ?? null,
    [drift],
  );

  return { drift, loading, statusFor, refetch: fetchDrift };
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
      setCoverage(await res.json());
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
