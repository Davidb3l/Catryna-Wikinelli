
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

export interface Document {
  id: string;
  title: string;
  blocks: Block[];
  lastUpdated: string;
  path: string[];
  isDraft?: boolean;
  history?: HistoryEntry[];
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
