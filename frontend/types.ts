
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

/**
 * Per-doc drift status from `GET /api/drift` — the real, git-computed verdict
 * behind the verified badge. Mirrors `DriftStatus` in src/drift.ts.
 *
 * `clean` = green, `drifted` = amber, `broken` = red, `unverified` = grey.
 */
export type DriftStatus = 'clean' | 'drifted' | 'broken' | 'unverified';

export interface DocDrift {
  status: DriftStatus;
  verifiedCommit: string;
  changedFiles: string[];
  brokenFiles?: string[];
}

export interface DriftResponse {
  gitRepo: boolean;
  head: string | null;
  error?: string;
  docs: Record<string, DocDrift>;
  summary: { clean: number; drifted: number; broken: number; unverified: number };
}

/** One undocumented source file, from `GET /api/coverage`. */
export interface UndocumentedModule {
  filePath: string;
  name: string;
  lastModified: number;
}

/** Coverage as of one commit, from `GET /api/coverage/trend`. Mirrors src/trend.ts. */
export interface CoverageSample {
  commit: string;
  timestamp: number;
  coveragePercent: number;
  totalModules: number;
  documentedModules: number;
  totalDocs: number;
}

export interface CoverageTrendResponse {
  samples: CoverageSample[];
  totalCommits: number;
  /** True when `samples` is a selection, not every commit — surface it, never hide it. */
  sampled: boolean;
  error?: string;
}

/** Coverage report from `GET /api/coverage`. Mirrors src/coverage.ts. */
export interface CoverageResponse {
  totalModules: number;
  documentedModules: number;
  coveragePercent: number;
  totalDocs: number;
  anchoringDocs: number;
  brokenAnchors: string[];
  undocumented: UndocumentedModule[];
  totalUndocumented: number;
  generatedAt: number;
}

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

/**
 * A named visual identity, distinct from the light/dark MODE.
 *
 * `classic` is the original Stripe-inspired look and honours `theme`
 * (light/dark/system). `atelier` is the catrynawiki.com identity and is dark by
 * design — it ignores `theme`, because a light variant of a deliberately
 * nocturnal palette loses what makes it work.
 */
export type ThemeStyle = 'classic' | 'atelier';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  /** Optional for backward compatibility: a stored pref from before this
   *  existed loads as `classic`, so nobody's viewer changes appearance on
   *  upgrade. */
  themeStyle?: ThemeStyle;
  whiteboardStyle: 'clean' | 'sketchy';
  fontSize: 'small' | 'medium' | 'large';
  editorLineNumbers: boolean;
}
