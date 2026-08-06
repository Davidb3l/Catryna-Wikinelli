
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Settings, HelpCircle, ChevronRight, ChevronDown, FileText,
  Menu, X, Plus, Clock, Terminal, Activity, Github, Edit3, Save,
  MousePointer2, History, RotateCcw, Check, Monitor, Moon, Sun,
  Type as TypeIcon, Layout, Box, Share2, Layers, Folder, Copy, ExternalLink,
  Filter, Calendar, Tag, AlertCircle, GripVertical, Trash2, Maximize2,
  Table as TableIcon, BarChart3, PieChart, Info, Loader2, FolderOpen, ChevronUp
} from 'lucide-react';
import { NavItem, Document, Block, UserPreferences, HistoryEntry, DriftStatus, DocDrift, CoverageTrendResponse } from './types';
import { useDocsList, useDoc, useDocsSearch, useDrift, useCoverage, useCoverageTrend, EMPTY_DOC } from './hooks/useDocs';
import { CoverageView, DocTrust, VerifiedBadge } from './components/Trust';
import { LazyCanvas } from './components/LazyCanvas';
import type { DiagramData } from './components/FlowDiagram';

/**
 * THE THREE HEAVY LIBRARIES ARE LAZY, AND MUST STAY THAT WAY.
 *
 * `mermaid` (plus the cytoscape/katex/per-diagram-type chunks behind it),
 * `reactflow` and `tldraw` together were ~900 KiB of the entry chunk, loaded on
 * every page view even though most docs open none of them. Each now lives
 * behind exactly one module that nothing else imports statically:
 *
 *   MermaidDiagram    -> only when a doc block carries metadata.diagramData.mermaid
 *   FlowDiagram       -> only for the non-mermaid diagram branch
 *   FlowEditorCanvas  -> only when the architecture editor is opened
 *   WhiteboardCanvas  -> only when the whiteboard editor is opened (activeEditor === 'wb')
 *
 * Adding a static `import … from 'mermaid' | 'reactflow' | 'tldraw'` anywhere
 * reachable from this file — including a type-only-looking value import such as
 * reactflow's `Position` enum — silently undoes all of it. Import types with
 * `import type`, and put anything that needs the runtime inside the boundary
 * module.
 */
const MermaidDiagram = React.lazy(() => import('./components/MermaidDiagram'));
const FlowDiagram = React.lazy(() => import('./components/FlowDiagram'));
const FlowEditorCanvas = React.lazy(() =>
  import('./components/FlowDiagram').then(m => ({ default: m.FlowEditorCanvas })));
const WhiteboardCanvas = React.lazy(() => import('./components/WhiteboardCanvas'));

/** Thin wiring: hooks in, pure view out. All rendering lives in components/Trust.tsx. */
const CoverageReport: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { coverage, loading, error } = useCoverage();
  const { drift } = useDrift();
  const { trend, loading: trendLoading } = useCoverageTrend();
  return (
    <CoverageView onClose={onClose} coverage={coverage} loading={loading} error={error}
                  drift={drift} trend={trend} trendLoading={trendLoading} />
  );
};


// --- Types & Interfaces ---
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

interface Project {
  name: string;
  path: string;
  docsPath: string;
}

// --- Components ---

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'accent' | 'secondary' }> = ({ children, className, variant = 'primary', ...props }) => {
  const variants = {
    primary: 'bg-navy text-white dark:bg-zinc-50 dark:text-zinc-900 hover:opacity-90',
    ghost: 'hover:bg-surface dark:hover:bg-zinc-800 text-navy-light dark:text-zinc-400',
    outline: 'border border-zinc-200 dark:border-zinc-800 hover:bg-surface dark:hover:bg-zinc-900 text-navy-light dark:text-zinc-300',
    accent: 'bg-accent text-white hover:bg-accent-hover',
    secondary: 'bg-surface text-navy dark:bg-zinc-800 dark:text-zinc-100 hover:opacity-90'
  };
  return (
    <button className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

const CommandPalette: React.FC<{ isOpen: boolean; onClose: () => void; onSelect: (id: string) => void; docs: Array<{ id: string; path: string; title: string; tags: string[] }> }> = ({ isOpen, onClose, onSelect, docs }) => {
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState('');
  const { results, loading, search } = useDocsSearch();

  useEffect(() => {
    if (query.length >= 2) {
      search(query);
    }
  }, [query, search]);

  if (!isOpen) return null;

  // Show search results if query, otherwise show all docs
  const displayDocs = query.length >= 2 ? results : docs;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] sm:pt-[15vh] bg-black/40 backdrop-blur-sm px-3 sm:px-4" onClick={onClose}>
      <div className="catryna-palette w-full max-w-xl bg-white dark:bg-zinc-900 rounded-lg sm:rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-zinc-100 dark:border-zinc-800">
          {loading ? <Loader2 size={18} className="text-zinc-400 animate-spin shrink-0" /> : <Search size={18} className="text-zinc-400 shrink-0" />}
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 text-sm min-w-0" placeholder="Search docs..." />
          <button onClick={() => setShowFilters(!showFilters)} className={`p-1.5 rounded-md shrink-0 ${showFilters ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><Filter size={16} /></button>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded-sm border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-400 font-sans shrink-0">ESC</kbd>
        </div>
        <div className="p-2 max-h-[50vh] sm:max-h-[400px] overflow-y-auto">
          {displayDocs.length === 0 ? (
            <div className="py-6 sm:py-8 text-center text-zinc-400 text-xs sm:text-sm">
              {query.length >= 2 ? 'No results found' : 'No docs yet. Create some with Claude Code!'}
            </div>
          ) : displayDocs.map(doc => (
            <div key={doc.id || doc.path} onClick={() => { onSelect(doc.path); onClose(); setQuery(''); }} className="catryna-result flex items-center justify-between px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-xs sm:text-sm group">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0"><FileText size={14} className="text-zinc-400 shrink-0 sm:w-4 sm:h-4" /><span className="truncate">{doc.title}</span></div>
              <span className="text-[9px] sm:text-[10px] text-zinc-400 uppercase opacity-0 group-hover:opacity-100 shrink-0 ml-2">{doc.path.split('/')[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const VersionHistorySidebar: React.FC<{
  isOpen: boolean; onClose: () => void; history: HistoryEntry[]; currentBlocks: Block[]; onRevert: (b: Block[]) => void
}> = ({ isOpen, onClose, history, currentBlocks, onRevert }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-80 lg:w-[450px] z-[150] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-3 sm:p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
        <h3 className="font-bold flex items-center gap-2 text-sm sm:text-base"><History size={18} /> Version History</h3>
        <Button variant="ghost" onClick={onClose} className="p-1"><X size={18} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
        {history.length === 0 && <div className="text-center py-10 text-zinc-400 text-sm">No versions found.</div>}
        {history.map(entry => (
          <div key={entry.id} className="p-3 sm:p-4 rounded-lg sm:rounded-xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
            <div className="flex justify-between items-start mb-2 gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-bold text-navy dark:text-zinc-50 truncate">{entry.summary}</span>
                <span className="text-[9px] sm:text-[10px] text-zinc-400 font-mono">{new Date(entry.timestamp).toLocaleString()}</span>
              </div>
              <div className="px-2 py-0.5 rounded-sm bg-zinc-100 dark:bg-zinc-800 text-[8px] sm:text-[9px] font-bold text-zinc-500 uppercase shrink-0">{entry.author}</div>
            </div>
            <div className="p-2 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg text-[10px] sm:text-[11px] font-mono text-zinc-500 mb-3 sm:mb-4 border border-zinc-100 dark:border-zinc-800">
              {entry.blocks.length} blocks changed
            </div>
            <Button variant="outline" className="w-full text-xs h-8 justify-center" onClick={() => onRevert(entry.blocks)}>
              <RotateCcw size={14} /> Revert
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};


// --- Main App ---

/** Where user preferences persist. Versioned so a future shape change can be
 *  migrated rather than silently misread. */
const PREFS_KEY = 'catryna.prefs.v1';

export default function App() {
  // Preferences PERSIST. They were previously in-memory only, so every reload
  // reset the viewer — which makes a theme picker close to useless. Unknown or
  // corrupt stored values fall back to the defaults rather than throwing, and a
  // pref saved before `themeStyle` existed simply loads without it (undefined
  // reads as 'classic'), so nobody's viewer changes appearance on upgrade.
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    const defaults: UserPreferences = {
      theme: 'dark', themeStyle: 'classic',
      whiteboardStyle: 'clean', fontSize: 'medium', editorLineNumbers: true,
    };
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode or a full quota — the app must still work, just forgetfully.
    }
  }, [prefs]);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isEditing, setIsEditing] = useState(false);
  const [activeEditor, setActiveEditor] = useState<null | 'diag' | 'wb' | 'coverage'>(null);
  const [editorDiagramData, setEditorDiagramData] = useState<{ nodes?: any[]; edges?: any[] } | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<string>('');
  const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Fetch projects list on mount
  useEffect(() => {
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        setProjects(data.projects || []);
        setCurrentProject(data.current || '');
        setProjectsLoading(false);
      })
      .catch(() => setProjectsLoading(false));
  }, []);

  // Fetch docs list and nav tree from .docs folder
  const { docs, navItems, loading: listLoading, error: listError, refetch: refetchList } = useDocsList();
  // Phase 2 trust surface: real, git-computed per-doc status for the badges.
  const { drift, statusFor: driftStatusFor, refetch: refetchDrift } = useDrift();

  // Fetch current document
  const { doc: fetchedDoc, loading: docLoading, error: docError } = useDoc(selectedDocPath);
  const currentDoc = fetchedDoc || EMPTY_DOC;

  // Atelier is dark BY DESIGN (see ThemeStyle in types.ts), so it pins the dark
  // class rather than consulting the light/dark preference. Classic behaves
  // exactly as it always has.
  //
  // This is derived rather than computed inside the effect because diagrams need
  // it too: it is threaded down to MermaidDiagram, which re-themes and re-renders
  // when it changes. Mermaid used to be re-initialized from the effect below,
  // which is what forced its ~1 MiB of chunks into every page view.
  const themeStyle = prefs.themeStyle ?? 'classic';
  const isDark = useMemo(
    () =>
      themeStyle === 'atelier' ||
      prefs.theme === 'dark' ||
      (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
    [prefs.theme, themeStyle],
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.toggle('dark', isDark);
    root.setAttribute('data-theme', themeStyle);
  }, [isDark, themeStyle]);

  const addToast = (message: string, type: Toast['type'] = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // The path of the doc actually rendered right now. EMPTY_DOC has an empty
  // path array, which correctly yields no badge.
  const renderedDocPath = currentDoc.path.length ? currentDoc.path.join('/') : null;

  const handleDocSelect = (path: string) => {
    setSelectedDocPath(path);
    setIsEditing(false);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handleProjectSwitch = async (projectPath: string) => {
    try {
      const res = await fetch('/api/projects/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      });
      if (res.ok) {
        setCurrentProject(projectPath);
        setSelectedDocPath(null);
        setIsProjectSelectorOpen(false);
        refetchList();
        // Drift is keyed by doc PATH, and paths collide across projects
        // (`architecture/overview`, `getting-started` are near-universal).
        // Without this, switching projects left the previous repo's verdicts in
        // place: an unverified doc in the new project rendered a green
        // "Verified" dot, with a baseline SHA from a different repository.
        refetchDrift();
        addToast(`Switched to ${projectPath.split('/').pop() || projectPath.split('\\').pop()}`);
      }
    } catch (e) {
      addToast('Failed to switch project', 'error');
    }
  };

  const tableOfContents = useMemo(() => {
    return currentDoc.blocks
      .filter(b => b.type.startsWith('heading'))
      .filter(b => !(b.type === 'heading-1' && b.content === currentDoc.title))
      .map(b => ({
        id: b.id,
        text: b.content,
        level: b.type === 'heading-1' ? 1 : b.type === 'heading-2' ? 2 : 3
      }));
  }, [currentDoc]);

  // Scroll spy - track which section is visible
  useEffect(() => {
    const headingIds = tableOfContents.map(t => t.id);
    if (headingIds.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px', threshold: 0 }
    );

    headingIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tableOfContents]);

  // Scroll to section when clicking ToC
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
    }
  };

  // Close project selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isProjectSelectorOpen && !(e.target as Element).closest('[data-project-selector]')) {
        setIsProjectSelectorOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isProjectSelectorOpen]);

  return (
    <div className={`flex h-screen w-full overflow-hidden bg-white dark:bg-zinc-950 transition-colors`}>
      {activeEditor === 'diag' && <DiagramEditor onClose={() => { setActiveEditor(null); setEditorDiagramData(null); }} diagramData={editorDiagramData || undefined} />}
      {activeEditor === 'wb' && <WhiteboardEditor onClose={() => setActiveEditor(null)} style={prefs.whiteboardStyle} />}
      {activeEditor === 'coverage' && <CoverageReport onClose={() => setActiveEditor(null)} />}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} prefs={prefs} setPrefs={setPrefs} />
      <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} onSelect={handleDocSelect} docs={docs} />
      <VersionHistorySidebar isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} history={currentDoc.history || []} currentBlocks={currentDoc.blocks} onRevert={(b) => { setIsHistoryOpen(false); addToast('Reverted'); }} />
      <ToastContainer toasts={toasts} onRemove={(id) => setToasts(toasts.filter(t => t.id !== id))} />

      {/* Mobile sidebar backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 lg:hidden transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside className={`catryna-sidebar fixed lg:relative h-full z-50 bg-surface-light dark:bg-zinc-900/40 border-r border-zinc-200/80 dark:border-zinc-800 transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} w-64`}>
        <div className="flex flex-col h-full w-64">
          <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 shrink-0 h-14">
            <div className="flex items-center gap-2 font-bold tracking-tight text-navy dark:text-zinc-50">
              <div className="w-6 h-6 bg-accent dark:bg-zinc-100 rounded-sm flex items-center justify-center text-white dark:text-zinc-900 shadow-lg">
                <span className="text-xs">🐱</span>
              </div>
              Catryna
            </div>
            <Button variant="ghost" onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1"><X size={16} /></Button>
          </div>

          {/* Project Selector */}
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-800" data-project-selector>
            <div className="relative">
              <button
                onClick={() => setIsProjectSelectorOpen(!isProjectSelectorOpen)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-sm border border-zinc-200/60 dark:border-zinc-800"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={14} className="text-accent shrink-0" />
                  <span className="truncate font-medium text-navy-light dark:text-zinc-300">
                    {projectsLoading ? 'Loading...' : (currentProject.split('/').pop() || currentProject.split('\\').pop() || 'Select Project')}
                  </span>
                </div>
                {isProjectSelectorOpen ? <ChevronUp size={14} className="text-zinc-400 shrink-0" /> : <ChevronDown size={14} className="text-zinc-400 shrink-0" />}
              </button>

              {isProjectSelectorOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                  {projects.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-zinc-400 text-center">
                      No projects with .docs folder found
                    </div>
                  ) : (
                    projects.map(project => (
                      <button
                        key={project.path}
                        onClick={() => handleProjectSwitch(project.path)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface dark:hover:bg-zinc-800 transition-colors ${
                          currentProject === project.path ? 'bg-accent/10 dark:bg-indigo-950/30 text-accent dark:text-indigo-400' : 'text-navy-light dark:text-zinc-400'
                        }`}
                      >
                        <Folder size={14} className={currentProject === project.path ? 'text-accent' : 'text-zinc-400'} />
                        <span className="truncate">{project.name}</span>
                        {currentProject === project.path && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
            {listLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-zinc-400" />
              </div>
            ) : navItems.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <div className="text-zinc-400 text-sm mb-2">No docs yet</div>
                <div className="text-zinc-500 text-xs">Use Claude Code to create documentation!</div>
              </div>
            ) : navItems.map(item => <SidebarItem key={item.id} item={item} depth={0} selectedId={selectedDocPath || ''} onSelect={handleDocSelect} statusFor={driftStatusFor} />)}
            <div className="mt-8 px-4"><label className="text-[10px] font-bold text-navy-light dark:text-zinc-400 uppercase tracking-widest mb-3 block">Reports</label><button onClick={() => setActiveEditor('coverage')} className="w-full flex items-center gap-2 text-sm text-navy-light dark:text-zinc-500 hover:text-accent py-1.5 transition-colors"><BarChart3 size={14} /> Doc Coverage</button></div>
          </div>
          <div className="p-3 sm:p-4 border-t border-zinc-200/80 dark:border-zinc-800 flex items-center gap-2 sm:gap-3 bg-white/50 dark:bg-zinc-900/50">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-accent flex items-center justify-center text-white font-bold text-[10px] sm:text-xs ring-2 ring-accent/20 shrink-0">CW</div>
            <div className="flex-1 min-w-0"><div className="text-[11px] sm:text-xs font-semibold truncate text-navy dark:text-zinc-200">Catryna</div><div className="text-[9px] sm:text-[10px] text-navy-light dark:text-zinc-500">v{__CATRYNA_VERSION__}</div></div>
            <Settings size={16} className="text-navy-light dark:text-zinc-400 cursor-pointer hover:text-accent shrink-0" onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 relative">
        <header className="h-12 sm:h-14 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 shrink-0 bg-white/95 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-2 sm:gap-4">
            {!isSidebarOpen && <Button variant="ghost" onClick={() => setIsSidebarOpen(true)} className="p-1"><Menu size={16} /></Button>}
            {/* Was a hardcoded green "● Synced" that claimed a sync status nothing
                backed. Reports the real drift summary instead, or nothing when
                there is no verdict to report. */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-zinc-400">
              {drift?.gitRepo && (
                drift.summary.broken + drift.summary.drifted + drift.summary.unverified === 0
                  ? <span className="text-green-700 dark:text-green-400">● {drift.summary.clean} verified</span>
                  : <span className="text-amber-500">
                      ● {drift.summary.broken > 0 && `${drift.summary.broken} broken, `}
                      {drift.summary.drifted > 0 && `${drift.summary.drifted} stale, `}
                      {drift.summary.clean} verified
                    </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" onClick={() => setIsSearchOpen(true)} className="text-xs h-8 px-2 sm:px-3"><Search size={16} /> <kbd className="hidden md:inline ml-2 opacity-50 font-sans">⌘K</kbd></Button>
            <Button variant="ghost" onClick={() => setIsHistoryOpen(true)} className="text-xs h-8 px-2 sm:px-3 hidden sm:flex"><History size={16} /></Button>
            {/* Drift is otherwise refetched only on mount and on window focus
                (throttled). This is the explicit "re-check now" for when you
                know something changed and don't want to wait. */}
            <Button variant="ghost" title="Re-check documentation drift" onClick={() => { refetchDrift(); addToast('Re-checking drift…', 'info'); }} className="text-xs h-8 px-2 sm:px-3 hidden sm:flex"><RotateCcw size={16} /></Button>
            {/* The old "Save" ran an 800ms timer and toasted "Saved" with no write
                path behind it — the docs API is GET-only, and the contentEditable
                blocks are never read back into state, so the edits existed only in
                DOM nodes and were discarded on the next render. A UI that confirms
                a write it never performed is the worst thing this product can do.
                The toggle is now honestly labelled a preview. */}
            {isEditing
              ? <Button variant="outline" onClick={() => setIsEditing(false)} className="h-8 px-2 sm:px-3"><X size={16} /> <span className="hidden sm:inline">Close preview</span></Button>
              : <Button variant="outline" onClick={() => setIsEditing(true)} className="h-8 px-2 sm:px-3"><Edit3 size={16} /> <span className="hidden sm:inline">Preview edits</span></Button>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto relative scrollbar-thin">
          {docLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={32} className="animate-spin text-zinc-400" />
            </div>
          ) : (
          <div className="flex justify-between max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-8 lg:py-12 gap-6 lg:gap-12">
            {/* `catryna-doc` is the styling hook for the READING EXPERIENCE
                (measure, typographic rhythm, code blocks, tables) in index.css.
                Doc headings render as <div>s rather than <h1>/<h2>, so a
                container class is the only way to reach them without touching
                every block renderer. */}
            <div className="catryna-doc flex-1 max-w-3xl min-w-0">
              <nav className="flex items-center gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] font-bold text-navy-light dark:text-zinc-400 uppercase tracking-widest mb-4 sm:mb-8 overflow-x-auto pb-1">
                {currentDoc.path.map((p, i) => <React.Fragment key={p}><button className="hover:text-accent whitespace-nowrap">{p}</button><ChevronRight size={10} className="shrink-0" /></React.Fragment>)}
                <span className="text-navy dark:text-zinc-100 whitespace-nowrap">{currentDoc.title}</span>
              </nav>
              {isEditing && (
                <div className="mb-4 p-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Preview only — changes are not saved.</span>{' '}
                    The docs API is read-only. Edit <code className="font-mono">.docs/{currentDoc.path.join('/')}.mdx</code> directly,
                    or ask Claude Code to update it via the <code className="font-mono">update_doc</code> MCP tool.
                  </div>
                </div>
              )}
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black tracking-tight mb-3 sm:mb-4 text-navy dark:text-zinc-50">{currentDoc.title}</h1>
              {/* Keyed off the doc actually on screen, not the selected path.
                  Previously these disagreed while a fetch was in flight, so a
                  slow response could render one doc's content beneath another
                  doc's verified badge and baseline SHA. */}
              <DocTrust
                status={renderedDocPath ? driftStatusFor(renderedDocPath) : null}
                detail={renderedDocPath ? drift?.docs?.[renderedDocPath] : undefined}
              />
              <div className="space-y-1 sm:space-y-2">
                {currentDoc.blocks
                  .filter(block => !(block.type === 'heading-1' && block.content === currentDoc.title))
                  .map(block => (
                  <BlockRenderer key={block.id} block={block} isEditing={isEditing} showLineNumbers={prefs.editorLineNumbers} whiteboardStyle={prefs.whiteboardStyle} isDark={isDark} onOpenEditor={(type, data) => { setActiveEditor(type); if (data) setEditorDiagramData(data); }} onDelete={id => {}} onCopy={() => addToast('Copied')} />
                ))}
              </div>
            </div>

            {/* Table of Contents - show on larger tablets and desktop */}
            <aside className="hidden lg:block w-40 xl:w-48 sticky top-0 h-fit pt-4 shrink-0">
              <div className="text-[10px] font-bold text-navy-light dark:text-zinc-400 uppercase tracking-widest mb-4">On this page</div>
              <ul className="space-y-2 xl:space-y-2.5 border-l border-zinc-200/80 dark:border-zinc-800">
                {tableOfContents.map(toc => (
                  <li
                    key={toc.id}
                    onClick={() => scrollToSection(toc.id)}
                    className={`text-[11px] xl:text-xs cursor-pointer transition-colors line-clamp-2 -ml-px pl-3 border-l-2 ${
                      activeSection === toc.id
                        ? 'border-accent text-accent dark:text-indigo-400 font-medium'
                        : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 ' + (toc.level === 1 ? 'font-bold text-navy-light dark:text-zinc-300' : 'text-navy-light/70 dark:text-zinc-500 pl-5 xl:pl-6')
                    }`}
                  >
                    {toc.text}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
          )}
        </div>
      </main>
    </div>
  );
}

const BlockRenderer: React.FC<{
  block: Block; isEditing: boolean; showLineNumbers: boolean; whiteboardStyle: 'clean' | 'sketchy'; isDark: boolean; onOpenEditor: (t: any, data?: any) => void; onDelete: (id: string) => void; onCopy: () => void
}> = ({ block, isEditing, showLineNumbers, whiteboardStyle, isDark, onOpenEditor, onDelete, onCopy }) => {
  // Gates the mermaid Expand button. The zoom modal is a ONE-SHOT DOM clone of
  // the rendered container, so expanding before the lazy chunk has produced an
  // SVG copies the loading spinner into a modal that never resolves — the only
  // way out being Close. Stays false until MermaidDiagram reports a render.
  const [mermaidReady, setMermaidReady] = useState(false);
  const markMermaidReady = useCallback(() => setMermaidReady(true), []);

  const wrapper = (children: React.ReactNode) => (
    <div className="group relative">
      {isEditing && (
        <div className="absolute -left-12 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-sm cursor-grab"><GripVertical size={14} className="text-zinc-300" /></div>
          <button onClick={() => onDelete(block.id)} className="p-1 hover:bg-red-50 text-red-400 rounded-sm"><Trash2 size={14} /></button>
        </div>
      )}
      {children}
    </div>
  );

  // Parse inline markdown (bold, italic, code, links)
  const parseInlineMarkdown = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Bold **text**
      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        parts.push(<strong key={key++} className="font-bold text-navy dark:text-zinc-100">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic *text*
      const italicMatch = remaining.match(/^\*(.+?)\*/);
      if (italicMatch) {
        parts.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Inline code `text`
      const codeMatch = remaining.match(/^`(.+?)`/);
      if (codeMatch) {
        parts.push(<code key={key++} className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-sm text-sm font-mono">{codeMatch[1]}</code>);
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Link [text](url)
      const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);
      if (linkMatch) {
        parts.push(<a key={key++} href={linkMatch[2]} className="text-accent hover:underline">{linkMatch[1]}</a>);
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // Regular character
      const nextSpecial = remaining.search(/[\*`\[]/);
      if (nextSpecial === -1) {
        parts.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        parts.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts;
  };

  if (block.type === 'diagram') {
    const diagramData = block.metadata?.diagramData;
    const hasData = diagramData && (diagramData.nodes?.length > 0 || diagramData.mermaid);

    // Render mermaid diagram
    if (hasData && diagramData.mermaid) {
      return wrapper(
        <div className="my-4 sm:my-8 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden group/item shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="px-3 sm:px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase flex items-center gap-2 text-zinc-500"><Layout size={12} className="text-indigo-500" /> Mermaid Diagram</span>
            {/* "not rendered yet" rather than "still loading": this is also the
                state after a mermaid PARSE error, where nothing is ever coming. */}
            <Button variant="ghost" disabled={!mermaidReady} title={mermaidReady ? 'Expand diagram' : 'Diagram not rendered yet'} onClick={() => {
              let zoom = 1;
              const modal = document.createElement('div');
              modal.className = 'fixed inset-0 z-[200] bg-zinc-950/95 flex flex-col';
              modal.innerHTML = `
                <div class="flex items-center justify-between p-4 border-b border-zinc-800">
                  <span class="text-sm font-bold text-zinc-300">Diagram View</span>
                  <div class="flex items-center gap-2">
                    <button id="zoom-out" class="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-sm text-sm text-zinc-300">−</button>
                    <span id="zoom-level" class="text-sm text-zinc-400 w-16 text-center">100%</span>
                    <button id="zoom-in" class="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-sm text-sm text-zinc-300">+</button>
                    <button id="close-modal" class="ml-4 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-sm text-sm text-zinc-300">Close</button>
                  </div>
                </div>
                <div class="flex-1 overflow-auto p-8 flex items-center justify-center">
                  <div id="diagram-content" class="mermaid-container transition-transform origin-center" style="transform: scale(1)"></div>
                </div>
              `;
              const content = modal.querySelector<HTMLElement>('#diagram-content')!;
              content.innerHTML = document.querySelector(`[data-mermaid-id="${block.id}"]`)?.innerHTML || '';
              modal.querySelector<HTMLElement>('#zoom-in')!.onclick = (e) => { e.stopPropagation(); zoom = Math.min(3, zoom + 0.25); content.style.transform = `scale(${zoom})`; modal.querySelector<HTMLElement>('#zoom-level')!.textContent = `${Math.round(zoom * 100)}%`; };
              modal.querySelector<HTMLElement>('#zoom-out')!.onclick = (e) => { e.stopPropagation(); zoom = Math.max(0.25, zoom - 0.25); content.style.transform = `scale(${zoom})`; modal.querySelector<HTMLElement>('#zoom-level')!.textContent = `${Math.round(zoom * 100)}%`; };
              modal.querySelector<HTMLElement>('#close-modal')!.onclick = () => modal.remove();
              document.body.appendChild(modal);
            }} className="text-xs h-7 opacity-0 group-hover/item:opacity-100"><Maximize2 size={12} /> <span className="hidden sm:inline">Expand</span></Button>
          </div>
          {/* The Expand handler above clones this container's innerHTML into the
              zoom modal, so the modal inherits whatever the lazy renderer has
              already produced — no second mermaid load, and nothing to expand
              until the chunk has landed. */}
          <div className="p-4 sm:p-8 bg-white dark:bg-zinc-900 overflow-x-auto" data-mermaid-id={block.id}>
            <LazyCanvas what="diagram">
              <MermaidDiagram chart={diagramData.mermaid} isDark={isDark} onRendered={markMermaidReady} />
            </LazyCanvas>
          </div>
        </div>
      );
    }

    // Render React Flow diagram. Node/edge normalization moved into
    // components/FlowDiagram.tsx — it needs reactflow's `Position` enum, and
    // importing that here would pull all of reactflow back into the entry chunk.
    if (hasData && diagramData.nodes) {
      return wrapper(
        <div className="my-4 sm:my-8 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden group/item">
          <div className="px-3 sm:px-4 py-2 bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase flex items-center gap-2 text-zinc-500"><Layout size={12} className="text-indigo-500" /> <span className="hidden sm:inline">Architecture</span> Diagram</span>
            <Button variant="ghost" onClick={() => onOpenEditor('diag', diagramData)} className="text-xs h-7 opacity-0 group-hover/item:opacity-100"><Maximize2 size={12} /> <span className="hidden sm:inline">Expand</span></Button>
          </div>
          <div className="h-[280px] sm:h-[350px] md:h-[400px] bg-zinc-50 dark:bg-zinc-950 touch-pan-y">
            <LazyCanvas what="diagram">
              <FlowDiagram diagramData={diagramData} />
            </LazyCanvas>
          </div>
        </div>
      );
    }

    // Fallback placeholder for empty diagrams
    return wrapper(
      <div className="my-4 sm:my-8 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 p-6 sm:p-12 flex flex-col items-center justify-center transition-all hover:border-indigo-500/30 min-h-[200px] sm:min-h-[300px] group/item inset-shadow-sm">
         <div className="px-3 py-1 bg-white dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-4 sm:mb-6 flex items-center gap-2 shadow-xs"><Layout size={12} className="text-indigo-500" /> Architecture Flow</div>
         <Activity size={32} className="text-zinc-200 dark:text-zinc-800 mb-4 sm:mb-6 sm:w-10 sm:h-10" />
         <Button variant="secondary" onClick={() => onOpenEditor('diag')} className="opacity-0 group-hover/item:opacity-100 text-xs sm:text-sm"><Maximize2 size={14} /> Open Editor</Button>
      </div>
    );
  }

  if (block.type === 'whiteboard') return wrapper(
    <div className={`my-4 sm:my-8 rounded-xl sm:rounded-2xl border-2 ${whiteboardStyle === 'sketchy' ? 'border-dashed border-zinc-200' : 'border-zinc-100 dark:border-zinc-800'} bg-white dark:bg-zinc-950 p-6 sm:p-12 min-h-[250px] sm:min-h-[400px] flex flex-col items-center justify-center group/item shadow-xs`}>
       <div className="px-3 py-1 bg-zinc-50 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-4 sm:mb-6 flex items-center gap-2"><Box size={12} className="text-amber-500" /> Whiteboard</div>
       <Share2 size={32} className="text-zinc-100 dark:text-zinc-900 mb-4 sm:mb-6 sm:w-10 sm:h-10" />
       <Button variant="outline" onClick={() => onOpenEditor('wb')} className="opacity-0 group-hover/item:opacity-100 text-xs sm:text-sm"><Edit3 size={14} /> Launch</Button>
    </div>
  );

  if (block.type === 'code') return wrapper(
    <div className="my-4 sm:my-6 rounded-lg sm:rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 shadow-xl sm:shadow-2xl group/code">
      <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
        <span className="text-[9px] sm:text-[10px] font-mono text-zinc-500 flex items-center gap-1.5 sm:gap-2 uppercase tracking-widest font-bold truncate max-w-[60%]"><Terminal size={12} className="shrink-0" /> <span className="truncate">{block.metadata?.filePath || 'app.ts'}</span></span>
        <div className="flex gap-1 sm:gap-2 opacity-100 sm:opacity-0 group-hover/code:opacity-100 transition-opacity">
           <button onClick={onCopy} className="p-1.5 sm:p-1 hover:bg-zinc-800 rounded-sm text-zinc-500 hover:text-white"><Copy size={14} className="sm:w-3 sm:h-3" /></button>
           <a href={`vscode://file/${block.metadata?.filePath}`} className="p-1.5 sm:p-1 hover:bg-zinc-800 rounded-sm text-zinc-500 hover:text-white hidden sm:block"><ExternalLink size={12} /></a>
        </div>
      </div>
      <div className="flex bg-zinc-950 overflow-x-auto">
        {showLineNumbers && <div className="hidden sm:block w-10 bg-zinc-900/40 border-r border-zinc-800 p-4 text-right text-zinc-700 font-mono text-xs select-none leading-relaxed shrink-0">{block.content.split('\n').map((_, i) => <div key={i}>{i+1}</div>)}</div>}
        <textarea readOnly={!isEditing} value={block.content} className="flex-1 p-3 sm:p-4 font-mono text-xs sm:text-sm bg-transparent text-zinc-300 focus:outline-none min-h-[80px] sm:min-h-[120px] resize-none overflow-x-auto leading-relaxed min-w-0" rows={Math.min(block.content.split('\n').length, 20)} />
      </div>
    </div>
  );

  if (block.type.startsWith('heading')) return wrapper(
    <div id={block.id} contentEditable={isEditing} className={`${block.type === 'heading-1' ? 'text-2xl sm:text-3xl font-black' : 'text-lg sm:text-xl font-bold'} mt-6 sm:mt-8 mb-3 sm:mb-4 outline-none text-navy dark:text-zinc-50 border-b-2 border-transparent focus:border-accent/20 scroll-mt-16 sm:scroll-mt-20`} suppressContentEditableWarning>{block.content}</div>
  );

  if (block.type === 'callout') return wrapper(
    <div className={`p-3 sm:p-4 rounded-lg sm:rounded-xl border flex gap-3 sm:gap-4 my-3 sm:my-4 bg-accent/5 dark:bg-indigo-950/20 border-accent/20 dark:border-indigo-900/50`}>
      <Info size={16} className="text-accent shrink-0 mt-0.5 sm:w-[18px] sm:h-[18px]" />
      <div contentEditable={isEditing} className="text-xs sm:text-sm leading-relaxed text-navy-light dark:text-zinc-300 outline-none" suppressContentEditableWarning>
        {isEditing ? block.content : parseInlineMarkdown(block.content)}
      </div>
    </div>
  );

  if (block.type === 'table') {
    const headers = block.metadata?.headers || [];
    const rows = block.metadata?.rows || [];
    return wrapper(
      <div className="my-4 sm:my-6 rounded-lg sm:rounded-xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm min-w-[400px]">
            <thead className="bg-surface dark:bg-zinc-900">
              <tr>
                {headers.map((header: string, i: number) => (
                  <th key={i} className="px-3 sm:px-4 py-2.5 sm:py-3 text-left font-bold text-navy dark:text-zinc-300 border-b border-zinc-200/80 dark:border-zinc-800 whitespace-nowrap">
                    {header.replace(/\*\*/g, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: string[], rowIdx: number) => (
                <tr key={rowIdx} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-surface/50 dark:hover:bg-zinc-900/50">
                  {row.map((cell: string, cellIdx: number) => (
                    <td key={cellIdx} className="px-3 sm:px-4 py-2.5 sm:py-3 text-navy-light dark:text-zinc-400">
                      {cell.replace(/\*\*/g, '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return wrapper(
    <div contentEditable={isEditing} className="leading-relaxed text-navy-light dark:text-zinc-300 min-h-[1.5em] outline-none py-1.5 focus:bg-surface dark:focus:bg-zinc-900 transition-colors" suppressContentEditableWarning>
      {isEditing ? block.content : parseInlineMarkdown(block.content)}
    </div>
  );
};

// Sub-components
const SidebarItem: React.FC<{ item: NavItem; depth: number; selectedId: string; onSelect: (id: string) => void; statusFor?: (path: string) => DriftStatus | null }> = ({ item, depth, selectedId, onSelect, statusFor }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = selectedId === item.id;
  // Only files carry a verdict; a folder is not a doc. `item.id` is the doc path.
  const status = item.type === 'file' && statusFor ? statusFor(item.id) : null;
  return (
    <div className="select-none mb-0.5">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs transition-all ${isSelected ? 'bg-white dark:bg-zinc-800 text-navy dark:text-zinc-50 font-bold shadow-xs' : 'text-navy-light dark:text-zinc-400 hover:bg-white/60 dark:hover:bg-zinc-900'}`} style={{ paddingLeft: `${(depth * 16) + 12}px` }} onClick={() => item.type === 'folder' ? setIsOpen(!isOpen) : onSelect(item.id)}>
        {item.type === 'folder' ? (isOpen ? <ChevronDown size={12} className="text-navy-light dark:text-zinc-400" /> : <ChevronRight size={12} className="text-navy-light dark:text-zinc-400" />) : <FileText size={14} className={isSelected ? 'text-accent' : 'text-navy-light/60 dark:text-zinc-400'} />}
        <span className="truncate">{item.title}</span>
        {/* Only render a dot when there is a real verdict — absence of data must
            not paint every doc with a status it does not have. */}
        {status && <span className="ml-auto shrink-0"><VerifiedBadge status={status} compact /></span>}
      </div>
      {item.type === 'folder' && isOpen && item.children && <div className="mt-0.5">{item.children.map(child => <SidebarItem key={child.id} item={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} statusFor={statusFor} />)}</div>}
    </div>
  );
};

const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => (
  <div className="fixed bottom-4 sm:bottom-6 left-4 right-4 sm:left-auto sm:right-6 z-[400] flex flex-col gap-2 pointer-events-none">
    {toasts.map(toast => (
      <div key={toast.id} className="pointer-events-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl p-3 sm:p-4 min-w-0 sm:min-w-[200px] flex items-center gap-2 sm:gap-3 animate-in slide-in-from-bottom-4 sm:slide-in-from-right-4">
        <Check size={14} className="text-green-500 shrink-0" />
        <span className="text-xs font-bold flex-1 truncate">{toast.message}</span>
        <button onClick={() => onRemove(toast.id)} className="text-zinc-400 p-1 shrink-0"><X size={14} /></button>
      </div>
    ))}
  </div>
);

/**
 * The selectable identities. `canvas` and `signature` are the literal colours
 * each theme paints with, so the swatch in Preferences is the real thing rather
 * than an approximation that can drift from the stylesheet.
 */
const THEME_STYLES: Array<{
  id: NonNullable<UserPreferences['themeStyle']>;
  label: string;
  note: string;
  blurb: string;
  canvas: string;
  signature: string;
}> = [
  {
    id: 'classic',
    label: 'Classic',
    note: 'Light, dark or system',
    blurb: 'The original look: clean Stripe-inspired surfaces, follows your light/dark preference.',
    canvas: '#F6F9FC',
    signature: '#635BFF',
  },
  {
    id: 'atelier',
    label: 'Atelier',
    note: 'Nocturnal, always dark',
    blurb: 'The catrynawiki.com identity: indigo-black canvas, Turbo Flow gradient, Fraunces display type.',
    canvas: '#0d0d16',
    signature: 'linear-gradient(112deg,#e92a67,#a853ba 50%,#2a8af6)',
  },
];

const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; prefs: UserPreferences; setPrefs: (p: UserPreferences) => void }> = ({ isOpen, onClose, prefs, setPrefs }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl sm:rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-5 sm:p-8" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg sm:text-xl font-bold mb-6 sm:mb-8 flex items-center gap-2 text-zinc-900 dark:text-zinc-50"><Settings size={20} /> Preferences</h2>
        <div className="space-y-6 sm:space-y-8">
           {/* THEME STYLE — the named identity, chosen before the light/dark
               mode because it decides whether that mode even applies. */}
           <section>
             <label className="text-[10px] font-bold uppercase text-zinc-400 mb-3 block">Theme</label>
             <div className="grid grid-cols-2 gap-2">
               {THEME_STYLES.map(s => {
                 const active = (prefs.themeStyle ?? 'classic') === s.id;
                 return (
                   <button
                     key={s.id}
                     onClick={() => setPrefs({ ...prefs, themeStyle: s.id })}
                     aria-pressed={active}
                     title={s.blurb}
                     className={`p-3 rounded-xl border text-left transition-all ${active ? 'border-indigo-500 ring-1 ring-indigo-500/40' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                   >
                     {/* Live swatch: the theme's actual canvas + signature. */}
                     <span className="flex items-center gap-1.5 mb-2">
                       <span className="w-6 h-6 rounded-md border border-black/10 dark:border-white/10" style={{ background: s.canvas }} />
                       <span className="w-6 h-6 rounded-md" style={{ background: s.signature }} />
                     </span>
                     <span className={`block text-[11px] font-bold ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{s.label}</span>
                     <span className="block text-[9px] text-zinc-400 leading-tight mt-0.5">{s.note}</span>
                   </button>
                 );
               })}
             </div>
           </section>

           {/* Light/dark mode. Atelier is dark by design, so the control is
               disabled rather than hidden — hiding it makes the setting look
               lost, while a disabled control with a reason explains itself. */}
           <section>
             <label className="text-[10px] font-bold uppercase text-zinc-400 mb-3 block">
               Mode
               {(prefs.themeStyle ?? 'classic') === 'atelier' && (
                 <span className="ml-2 normal-case font-medium text-zinc-500">Atelier is always dark</span>
               )}
             </label>
             <div className={`grid grid-cols-3 gap-2 ${(prefs.themeStyle ?? 'classic') === 'atelier' ? 'opacity-40 pointer-events-none' : ''}`}>
               {(['light', 'dark', 'system'] as const).map(t => <button key={t} disabled={(prefs.themeStyle ?? 'classic') === 'atelier'} onClick={() => setPrefs({...prefs, theme: t})} className={`p-3 sm:p-4 rounded-lg sm:rounded-xl border flex flex-col items-center gap-1.5 sm:gap-2 ${prefs.theme === t ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-600' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400'}`}>{t === 'light' ? <Sun size={18} /> : t === 'dark' ? <Moon size={18} /> : <Monitor size={18} />}<span className="text-[9px] sm:text-[10px] font-bold uppercase">{t}</span></button>)}
             </div>
           </section>
           <section><label className="text-[10px] font-bold uppercase text-zinc-400 mb-3 block">Canvas Style</label><div className="flex gap-2">{(['clean', 'sketchy'] as const).map(s => <button key={s} onClick={() => setPrefs({...prefs, whiteboardStyle: s})} className={`flex-1 p-2.5 sm:p-3 rounded-lg sm:rounded-xl border text-[10px] font-bold uppercase ${prefs.whiteboardStyle === s ? 'border-indigo-500 text-indigo-600' : 'border-zinc-200 dark:border-zinc-800'}`}>{s}</button>)}</div></section>
        </div>
        <div className="mt-8 sm:mt-10 flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </div>
    </div>
  );
};

/** Editor CHROME stays eager so the modal opens instantly; only the reactflow
 *  canvas inside it is lazy. Node/edge state lives in FlowEditorCanvas. */
const DiagramEditor: React.FC<{ onClose: () => void; diagramData?: DiagramData }> = ({ onClose, diagramData }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-zinc-950 flex flex-col animate-in fade-in duration-300">
      <header className="h-12 sm:h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 shrink-0 z-10 bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-2 sm:gap-4"><Button variant="ghost" onClick={onClose} className="p-1"><X size={20} /></Button><span className="font-bold flex items-center gap-2 text-sm sm:text-base"><Layout size={18} className="text-indigo-500" /> <span className="hidden sm:inline">Architecture</span> Editor</span></div>
        <Button variant="accent" onClick={onClose} className="px-2 sm:px-3"><Save size={16} /> <span className="hidden sm:inline">Save Diagram</span><span className="sm:hidden">Save</span></Button>
      </header>
      <div className="flex-1 touch-pan-y">
        <LazyCanvas what="diagram editor">
          <FlowEditorCanvas diagramData={diagramData} />
        </LazyCanvas>
      </div>
    </div>
  );
};

const WhiteboardEditor: React.FC<{ onClose: () => void; style: 'clean' | 'sketchy' }> = ({ onClose, style }) => (
  <div className="fixed inset-0 z-[100] bg-white dark:bg-zinc-950 flex flex-col animate-in slide-in-from-bottom duration-300">
    <header className="h-12 sm:h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 shrink-0 z-10 bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 sm:gap-4"><Button variant="ghost" onClick={onClose} className="p-1"><X size={20} /></Button><span className="font-bold flex items-center gap-2 text-sm sm:text-base"><Box size={18} className="text-amber-500" /> Whiteboard</span></div>
      <Button variant="accent" onClick={onClose} className="px-2 sm:px-3"><Save size={16} /> Save</Button>
    </header>
    {/* Same shape as DiagramEditor: chrome eager, canvas lazy. tldraw is the
        single largest dependency here and nothing but this modal needs it. */}
    <div className="flex-1 tldraw__editor">
      <LazyCanvas what="whiteboard">
        <WhiteboardCanvas />
      </LazyCanvas>
    </div>
  </div>
);
