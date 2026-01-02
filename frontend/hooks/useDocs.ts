import { useState, useEffect, useCallback } from 'react';
import type { Document, NavItem, Block } from '../types';

// API response types
interface DocMetadata {
  id: string;
  path: string;
  title: string;
  tags: string[];
  relatedFiles: string[];
  createdAt: number;
  updatedAt: number;
}

interface DocsIndex {
  version: number;
  docs: DocMetadata[];
  lastUpdated: number | null;
}

interface DocResponse extends DocMetadata {
  blocks: Block[];
  raw: string;
}

interface SearchResult {
  results: DocMetadata[];
  query: string;
}

// Convert API doc to frontend Document type
function toDocument(doc: DocResponse): Document {
  return {
    id: doc.id || doc.path,
    title: doc.title,
    path: doc.path.split('/'),
    blocks: doc.blocks || [],
    lastUpdated: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
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
      setDocs(data.docs || []);
      setNavItems(buildNavTree(data.docs || []));
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
      setResults(data.results || []);
      return data.results || [];
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
