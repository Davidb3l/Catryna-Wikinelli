
import { NavItem, Document, Block } from './types';

export const INITIAL_NAV_ITEMS: NavItem[] = [
  {
    id: 'intro',
    title: 'Getting Started',
    type: 'folder',
    children: [
      { id: 'welcome', title: 'Welcome to Catryna', type: 'file' },
      { id: 'concepts', title: 'Core Concepts', type: 'file' },
    ]
  },
  {
    id: 'api-ref',
    title: 'API Reference',
    type: 'folder',
    children: [
      { id: 'auth', title: 'Authentication', type: 'file' },
      { id: 'users', title: 'Users Resource', type: 'file' },
    ]
  },
  {
    id: 'architecture',
    title: 'Architecture',
    type: 'folder',
    children: [
      { id: 'flow', title: 'System Flow', type: 'file' },
      { id: 'db-schema', title: 'Database Schema', type: 'file' },
    ]
  }
];

export const MOCK_DOCS: Record<string, Document> = {
  'welcome': {
    id: 'welcome',
    title: 'Welcome to Catryna',
    path: ['Getting Started'],
    lastUpdated: '2025-12-31T14:30:00Z',
    blocks: [
      { id: 'b1', type: 'paragraph', content: 'Welcome to **Catryna Wikinelli**, your local-first documentation companion.' },
      { id: 'b2', type: 'heading-2', content: 'Visual Architecture' },
      { id: 'b-diag', type: 'diagram', content: '', metadata: { diagramData: {} } },
      { id: 'b3', type: 'callout', content: 'Tip: You can now sketch ideas directly in the doc using our whiteboard block.', metadata: { level: 'info' } },
      { id: 'b-wb', type: 'whiteboard', content: '', metadata: { whiteboardData: {} } },
      { id: 'b5', type: 'code', content: 'export const config = {\n  provider: "google-gemini",\n  model: "gemini-3-flash-preview"\n};', metadata: { language: 'typescript', filePath: 'catryna.config.ts' } }
    ]
  },
  'auth': {
    id: 'auth',
    title: 'Authentication',
    path: ['API Reference'],
    lastUpdated: '2025-12-30T11:00:00Z',
    blocks: [
      { id: 'a1', type: 'paragraph', content: 'OAuth 2.0 implementation details for the project.' },
      { id: 'a2', type: 'code', content: 'const auth = await authenticate(token);', metadata: { language: 'typescript', filePath: 'src/lib/auth.ts' } }
    ]
  }
};
