
export type BlockType = 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3' | 'code' | 'callout' | 'diagram' | 'whiteboard' | 'divider' | 'table';

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  metadata?: {
    language?: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    filePath?: string;
    diagramData?: any;
    whiteboardData?: any;
    headers?: string[];
    rows?: string[][];
  };
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  author: string;
  blocks: Block[];
  summary: string;
}

/** A doc's anchor into code — mirrors `DocAnchor` in src/storage.ts. */
export interface DocAnchor {
  file: string;
  symbol?: string;
  lines?: [number, number];
}

/**
 * A doc's drift/verification state, as recorded by `catryna verify` and
 * `catryna consume`. Mirrors the drift fields of `DocMetadata` in
 * src/storage.ts; see that file for the full semantics.
 *
 * Empty strings mean "never verified" / "not suspect" — the same convention the
 * backend normalizes to, so a legacy index missing these fields reads as
 * unverified rather than silently clean.
 */
export interface DocVerification {
  anchors: DocAnchor[];
  verifiedCommit: string;
  verifiedAt: string;
  driftSuspectSince: string;
  driftSuspectReason: string;
}

/** Verification state reduced to what a badge needs. Derived by `verificationStatus`. */
export type VerificationStatus = 'verified' | 'suspect' | 'unverified';

export interface Document {
  id: string;
  title: string;
  blocks: Block[];
  lastUpdated: string;
  path: string[];
  isDraft?: boolean;
  history?: HistoryEntry[];
  /** Drift baseline for this doc. Absent only if the API omitted it entirely. */
  verification?: DocVerification;
}

export interface NavItem {
  id: string;
  title: string;
  type: 'file' | 'folder';
  children?: NavItem[];
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  whiteboardStyle: 'clean' | 'sketchy';
  fontSize: 'small' | 'medium' | 'large';
  editorLineNumbers: boolean;
}
