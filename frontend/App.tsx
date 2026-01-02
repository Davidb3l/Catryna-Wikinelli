
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, Settings, HelpCircle, ChevronRight, ChevronDown, FileText,
  Menu, X, Plus, Clock, Terminal, Activity, Github, Edit3, Save,
  MousePointer2, History, RotateCcw, Check, Monitor, Moon, Sun,
  Type as TypeIcon, Layout, Box, Share2, Layers, Folder, Copy, ExternalLink,
  Filter, Calendar, Tag, Sparkles, AlertCircle, GripVertical, Trash2, Maximize2,
  Table as TableIcon, BarChart3, PieChart, Info, Loader2, FolderOpen, ChevronUp
} from 'lucide-react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import { Tldraw } from 'tldraw';
import { NavItem, Document, Block, UserPreferences, HistoryEntry } from './types';
import { useDocsList, useDoc, useDocsSearch, EMPTY_DOC } from './hooks/useDocs';
import { geminiService } from './services/geminiService';
import * as Diff from 'diff';

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
    primary: 'bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 hover:opacity-90',
    ghost: 'hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
    outline: 'border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300',
    accent: 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 hover:opacity-90'
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
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          {loading ? <Loader2 size={18} className="text-zinc-400 animate-spin" /> : <Search size={18} className="text-zinc-400" />}
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 text-sm" placeholder="Search docs..." />
          <button onClick={() => setShowFilters(!showFilters)} className={`p-1.5 rounded-md ${showFilters ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-zinc-400 hover:bg-zinc-100'}`}><Filter size={16} /></button>
          <kbd className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-400 font-sans">ESC</kbd>
        </div>
        <div className="p-2 max-h-[400px] overflow-y-auto">
          {displayDocs.length === 0 ? (
            <div className="py-8 text-center text-zinc-400 text-sm">
              {query.length >= 2 ? 'No results found' : 'No docs yet. Create some with Claude Code!'}
            </div>
          ) : displayDocs.map(doc => (
            <div key={doc.id || doc.path} onClick={() => { onSelect(doc.path); onClose(); setQuery(''); }} className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-sm group">
              <div className="flex items-center gap-3"><FileText size={16} className="text-zinc-400" /><span>{doc.title}</span></div>
              <span className="text-[10px] text-zinc-400 uppercase opacity-0 group-hover:opacity-100">{doc.path.split('/')[0]}</span>
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
    <div className="fixed inset-y-0 right-0 w-80 lg:w-[450px] z-[150] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
        <h3 className="font-bold flex items-center gap-2"><History size={18} /> Version History</h3>
        <Button variant="ghost" onClick={onClose} className="p-1"><X size={18} /></Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {history.length === 0 && <div className="text-center py-10 text-zinc-400 text-sm">No versions found.</div>}
        {history.map(entry => (
          <div key={entry.id} className="p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
            <div className="flex justify-between items-start mb-2">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{entry.summary}</span>
                <span className="text-[10px] text-zinc-400 font-mono">{new Date(entry.timestamp).toLocaleString()}</span>
              </div>
              <div className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[9px] font-bold text-zinc-500 uppercase">{entry.author}</div>
            </div>
            <div className="p-2 bg-zinc-50 dark:bg-zinc-900/30 rounded-lg text-[11px] font-mono text-zinc-500 mb-4 border border-zinc-100 dark:border-zinc-800">
              {entry.blocks.length} blocks changed
            </div>
            <Button variant="outline" className="w-full text-xs h-8 justify-center" onClick={() => onRevert(entry.blocks)}>
              <RotateCcw size={14} /> Revert Changes
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

const CoverageReport: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[160] bg-white dark:bg-zinc-950 flex flex-col animate-in fade-in duration-300">
    <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-3"><Button variant="ghost" onClick={onClose}><X size={20} /></Button><h2 className="font-bold flex items-center gap-2"><BarChart3 size={18} /> Documentation Coverage</h2></div>
      <Button variant="accent"><Sparkles size={16} /> Auto-Generate Missing</Button>
    </header>
    <div className="flex-1 overflow-y-auto p-6 lg:p-12 max-w-5xl mx-auto w-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800"><div className="text-xs text-zinc-400 font-bold uppercase mb-2">Health Score</div><div className="text-4xl font-black text-indigo-600">84%</div></div>
        <div className="p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800"><div className="text-xs text-zinc-400 font-bold uppercase mb-2">Total Pages</div><div className="text-4xl font-black text-zinc-900 dark:text-white">42</div></div>
        <div className="p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800"><div className="text-xs text-zinc-400 font-bold uppercase mb-2">Missing Context</div><div className="text-4xl font-black text-amber-500">12</div></div>
      </div>
      <div className="space-y-4">
        {['auth-service.ts', 'user-controller.go', 'database-layer.rs', 'frontend-api.ts'].map((f, i) => (
          <div key={f} className="p-4 bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3"><Terminal size={16} className="text-zinc-400" /><span className="text-sm font-medium">{f}</span></div>
            <div className="flex items-center gap-4">
              <div className="w-24 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: i === 3 ? '20%' : '100%' }} /></div>
              <span className={`text-xs font-bold ${i === 3 ? 'text-red-500' : 'text-green-500'}`}>{i === 3 ? 'Missing' : 'Documented'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// --- Main App ---

export default function App() {
  const [prefs, setPrefs] = useState<UserPreferences>({ theme: 'dark', whiteboardStyle: 'clean', fontSize: 'medium', editorLineNumbers: true });
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const [isEditing, setIsEditing] = useState(false);
  const [activeEditor, setActiveEditor] = useState<null | 'diag' | 'wb' | 'coverage'>(null);
  const [editorDiagramData, setEditorDiagramData] = useState<{ nodes?: any[]; edges?: any[] } | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  // Fetch current document
  const { doc: fetchedDoc, loading: docLoading, error: docError } = useDoc(selectedDocPath);
  const currentDoc = fetchedDoc || EMPTY_DOC;

  useEffect(() => {
    const root = window.document.documentElement;
    if (prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [prefs.theme]);

  const addToast = (message: string, type: Toast['type'] = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

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

      {isSidebarOpen && window.innerWidth < 1024 && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setIsSidebarOpen(false)} />}

      <aside className={`fixed lg:relative h-full z-50 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full lg:translate-x-0'}`}>
        <div className="flex flex-col h-full w-64">
          <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 shrink-0 h-14">
            <div className="flex items-center gap-2 font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              <div className="w-6 h-6 bg-zinc-900 dark:bg-zinc-100 rounded flex items-center justify-center text-white dark:text-zinc-900 shadow-xl">
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
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={14} className="text-indigo-500 shrink-0" />
                  <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
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
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                          currentProject === project.path ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400' : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <Folder size={14} className={currentProject === project.path ? 'text-indigo-500' : 'text-zinc-400'} />
                        <span className="truncate">{project.name}</span>
                        {currentProject === project.path && <Check size={14} className="ml-auto shrink-0 text-indigo-500" />}
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
            ) : navItems.map(item => <SidebarItem key={item.id} item={item} depth={0} selectedId={selectedDocPath || ''} onSelect={handleDocSelect} />)}
            <div className="mt-8 px-4"><label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3 block">Reports</label><button onClick={() => setActiveEditor('coverage')} className="w-full flex items-center gap-2 text-sm text-zinc-500 hover:text-indigo-500 py-1.5 transition-colors"><BarChart3 size={14} /> Doc Coverage</button></div>
          </div>
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-xs ring-2 ring-indigo-500/20">CW</div>
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate">Catryna Wikinelli</div><div className="text-[10px] text-zinc-500">v2.5.0-beta</div></div>
            <Settings size={16} className="text-zinc-400 cursor-pointer hover:text-indigo-500" onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-950 relative">
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && <Button variant="ghost" onClick={() => setIsSidebarOpen(true)} className="p-1"><Menu size={16} /></Button>}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold text-zinc-400">
               {isSaving ? <span className="text-indigo-500 animate-pulse">● Saving...</span> : <span className="text-green-500">● Local Synced</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setIsSearchOpen(true)} className="text-xs h-8"><Search size={16} /> <kbd className="hidden md:inline ml-2 opacity-50 font-sans">⌘K</kbd></Button>
            <Button variant="ghost" onClick={() => setIsHistoryOpen(true)} className="text-xs h-8"><History size={16} /></Button>
            {isEditing ? <Button variant="accent" onClick={() => { setIsSaving(true); setTimeout(() => { setIsSaving(false); setIsEditing(false); addToast('Saved'); }, 800); }} className="h-8"><Save size={16} /> Save</Button> : <Button variant="outline" onClick={() => setIsEditing(true)} className="h-8"><Edit3 size={16} /> Edit</Button>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto relative scrollbar-thin">
          {docLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={32} className="animate-spin text-zinc-400" />
            </div>
          ) : (
          <div className="flex justify-between max-w-6xl mx-auto px-6 lg:px-12 py-12 gap-12">
            <div className="flex-1 max-w-3xl">
              <nav className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-8">
                {currentDoc.path.map((p, i) => <React.Fragment key={p}><button className="hover:text-indigo-500">{p}</button><ChevronRight size={10} /></React.Fragment>)}
                <span className="text-zinc-900 dark:text-zinc-100">{currentDoc.title}</span>
              </nav>
              <h1 className="text-4xl lg:text-5xl font-black tracking-tight mb-10 text-zinc-900 dark:text-zinc-50">{currentDoc.title}</h1>
              <div className="space-y-2">
                {currentDoc.blocks
                  .filter(block => !(block.type === 'heading-1' && block.content === currentDoc.title))
                  .map(block => (
                  <BlockRenderer key={block.id} block={block} isEditing={isEditing} showLineNumbers={prefs.editorLineNumbers} whiteboardStyle={prefs.whiteboardStyle} onOpenEditor={(type, data) => { setActiveEditor(type); if (data) setEditorDiagramData(data); }} onDelete={id => {}} onCopy={() => addToast('Copied')} />
                ))}
              </div>
            </div>

            {/* Table of Contents */}
            <aside className="hidden xl:block w-48 sticky top-0 h-fit pt-4">
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-4">On this page</div>
              <ul className="space-y-2.5 border-l border-zinc-200 dark:border-zinc-800">
                {tableOfContents.map(toc => (
                  <li
                    key={toc.id}
                    onClick={() => scrollToSection(toc.id)}
                    className={`text-xs cursor-pointer transition-colors line-clamp-2 -ml-px pl-3 border-l-2 ${
                      activeSection === toc.id
                        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-medium'
                        : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 ' + (toc.level === 1 ? 'font-bold text-zinc-700 dark:text-zinc-300' : 'text-zinc-500 pl-6')
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
  block: Block; isEditing: boolean; showLineNumbers: boolean; whiteboardStyle: 'clean' | 'sketchy'; onOpenEditor: (t: any, data?: any) => void; onDelete: (id: string) => void; onCopy: () => void
}> = ({ block, isEditing, showLineNumbers, whiteboardStyle, onOpenEditor, onDelete, onCopy }) => {
  const wrapper = (children: React.ReactNode) => (
    <div className="group relative">
      {isEditing && (
        <div className="absolute -left-12 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded cursor-grab"><GripVertical size={14} className="text-zinc-300" /></div>
          <button onClick={() => onDelete(block.id)} className="p-1 hover:bg-red-50 text-red-400 rounded"><Trash2 size={14} /></button>
        </div>
      )}
      {children}
    </div>
  );

  if (block.type === 'diagram') {
    const diagramData = block.metadata?.diagramData;
    const hasData = diagramData && (diagramData.nodes?.length > 0 || diagramData.mermaid);

    if (hasData && diagramData.nodes) {
      // Render actual React Flow diagram
      return wrapper(
        <div className="my-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden group/item">
          <div className="px-4 py-2 bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase flex items-center gap-2 text-zinc-500"><Layout size={12} className="text-indigo-500" /> Architecture Diagram</span>
            <Button variant="ghost" onClick={() => onOpenEditor('diag', diagramData)} className="text-xs h-7 opacity-0 group-hover/item:opacity-100"><Maximize2 size={12} /> Expand</Button>
          </div>
          <div className="h-[400px] bg-zinc-50 dark:bg-zinc-950">
            <ReactFlow
              nodes={diagramData.nodes}
              edges={diagramData.edges || []}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#71717a" gap={16} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>
      );
    }

    // Fallback placeholder for empty diagrams
    return wrapper(
      <div className="my-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 p-12 flex flex-col items-center justify-center transition-all hover:border-indigo-500/30 min-h-[300px] group/item shadow-inner">
         <div className="px-3 py-1 bg-white dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-6 flex items-center gap-2 shadow-sm"><Layout size={12} className="text-indigo-500" /> Architecture Flow</div>
         <Activity size={40} className="text-zinc-200 dark:text-zinc-800 mb-6" />
         <Button variant="secondary" onClick={() => onOpenEditor('diag')} className="opacity-0 group-hover/item:opacity-100"><Maximize2 size={14} /> Open Diagram Editor</Button>
      </div>
    );
  }

  if (block.type === 'whiteboard') return wrapper(
    <div className={`my-8 rounded-2xl border-2 ${whiteboardStyle === 'sketchy' ? 'border-dashed border-zinc-200' : 'border-zinc-100 dark:border-zinc-800'} bg-white dark:bg-zinc-950 p-12 min-h-[400px] flex flex-col items-center justify-center group/item shadow-sm`}>
       <div className="px-3 py-1 bg-zinc-50 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-6 flex items-center gap-2"><Box size={12} className="text-amber-500" /> Whiteboard ({whiteboardStyle})</div>
       <Share2 size={40} className="text-zinc-100 dark:text-zinc-900 mb-6" />
       <Button variant="outline" onClick={() => onOpenEditor('wb')} className="opacity-0 group-hover/item:opacity-100"><Edit3 size={14} /> Launch Whiteboard</Button>
    </div>
  );

  if (block.type === 'code') return wrapper(
    <div className="my-6 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 shadow-2xl group/code">
      <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
        <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-2 uppercase tracking-widest font-bold"><Terminal size={12} /> {block.metadata?.filePath || 'app.ts'}</span>
        <div className="flex gap-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
           <button onClick={onCopy} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white"><Copy size={12} /></button>
           <a href={`vscode://file/${block.metadata?.filePath}`} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white"><ExternalLink size={12} /></a>
        </div>
      </div>
      <div className="flex bg-zinc-950">
        {showLineNumbers && <div className="w-10 bg-zinc-900/40 border-r border-zinc-800 p-4 text-right text-zinc-700 font-mono text-xs select-none leading-relaxed">{block.content.split('\n').map((_, i) => <div key={i}>{i+1}</div>)}</div>}
        <textarea readOnly={!isEditing} value={block.content} className="flex-1 p-4 font-mono text-sm bg-transparent text-zinc-300 focus:outline-none min-h-[120px] resize-none overflow-hidden leading-relaxed" rows={block.content.split('\n').length} />
      </div>
    </div>
  );

  if (block.type.startsWith('heading')) return wrapper(
    <div id={block.id} contentEditable={isEditing} className={`${block.type === 'heading-1' ? 'text-3xl font-black' : 'text-xl font-bold'} mt-8 mb-4 outline-none text-zinc-900 dark:text-zinc-50 border-b-2 border-transparent focus:border-indigo-500/20 scroll-mt-20`} suppressContentEditableWarning>{block.content}</div>
  );

  if (block.type === 'callout') return wrapper(
    <div className={`p-4 rounded-xl border flex gap-4 my-4 bg-indigo-50/30 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/50`}>
      <Info size={18} className="text-indigo-500 shrink-0 mt-0.5" />
      <div contentEditable={isEditing} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 outline-none" suppressContentEditableWarning>{block.content}</div>
    </div>
  );

  if (block.type === 'table') {
    const headers = block.metadata?.headers || [];
    const rows = block.metadata?.rows || [];
    return wrapper(
      <div className="my-6 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              {headers.map((header: string, i: number) => (
                <th key={i} className="px-4 py-3 text-left font-bold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-800">
                  {header.replace(/\*\*/g, '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: string[], rowIdx: number) => (
              <tr key={rowIdx} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                {row.map((cell: string, cellIdx: number) => (
                  <td key={cellIdx} className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {cell.replace(/\*\*/g, '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return wrapper(
    <div contentEditable={isEditing} className="leading-relaxed text-zinc-700 dark:text-zinc-300 min-h-[1.5em] outline-none py-1.5 focus:bg-zinc-50 dark:focus:bg-zinc-900 transition-colors" suppressContentEditableWarning>{block.content}</div>
  );
};

// Sub-components
const SidebarItem: React.FC<{ item: NavItem; depth: number; selectedId: string; onSelect: (id: string) => void }> = ({ item, depth, selectedId, onSelect }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = selectedId === item.id;
  return (
    <div className="select-none mb-0.5">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs transition-all ${isSelected ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 font-bold' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`} style={{ paddingLeft: `${(depth * 16) + 12}px` }} onClick={() => item.type === 'folder' ? setIsOpen(!isOpen) : onSelect(item.id)}>
        {item.type === 'folder' ? (isOpen ? <ChevronDown size={12} className="text-zinc-400" /> : <ChevronRight size={12} className="text-zinc-400" />) : <FileText size={14} className={isSelected ? 'text-indigo-500' : 'text-zinc-400'} />}
        <span className="truncate">{item.title}</span>
      </div>
      {item.type === 'folder' && isOpen && item.children && <div className="mt-0.5">{item.children.map(child => <SidebarItem key={child.id} item={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />)}</div>}
    </div>
  );
};

const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => (
  <div className="fixed bottom-6 right-6 z-[400] flex flex-col gap-2 pointer-events-none">
    {toasts.map(toast => (
      <div key={toast.id} className="pointer-events-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl p-4 min-w-[200px] flex items-center gap-3 animate-in slide-in-from-right-4">
        <Check size={14} className="text-green-500" />
        <span className="text-xs font-bold flex-1">{toast.message}</span>
        <button onClick={() => onRemove(toast.id)} className="text-zinc-400 p-1"><X size={14} /></button>
      </div>
    ))}
  </div>
);

const SettingsModal: React.FC<{ isOpen: boolean; onClose: () => void; prefs: UserPreferences; setPrefs: (p: UserPreferences) => void }> = ({ isOpen, onClose, prefs, setPrefs }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-8" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-8 flex items-center gap-2"><Settings size={20} /> Preferences</h2>
        <div className="space-y-8">
           <section><label className="text-[10px] font-bold uppercase text-zinc-400 mb-3 block">Theme</label><div className="grid grid-cols-3 gap-2">{(['light', 'dark', 'system'] as const).map(t => <button key={t} onClick={() => setPrefs({...prefs, theme: t})} className={`p-4 rounded-xl border flex flex-col items-center gap-2 ${prefs.theme === t ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-600' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400'}`}>{t === 'light' ? <Sun size={18} /> : t === 'dark' ? <Moon size={18} /> : <Monitor size={18} />}<span className="text-[10px] font-bold uppercase">{t}</span></button>)}</div></section>
           <section><label className="text-[10px] font-bold uppercase text-zinc-400 mb-3 block">Canvas Style</label><div className="flex gap-2">{(['clean', 'sketchy'] as const).map(s => <button key={s} onClick={() => setPrefs({...prefs, whiteboardStyle: s})} className={`flex-1 p-3 rounded-xl border text-[10px] font-bold uppercase ${prefs.whiteboardStyle === s ? 'border-indigo-500 text-indigo-600' : 'border-zinc-200 dark:border-zinc-800'}`}>{s}</button>)}</div></section>
        </div>
        <div className="mt-10 flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </div>
    </div>
  );
};

const DiagramEditor: React.FC<{ onClose: () => void; diagramData?: { nodes?: any[]; edges?: any[] } }> = ({ onClose, diagramData }) => {
  const [nodes, setNodes] = useState(diagramData?.nodes || [{ id: '1', data: { label: 'New Node' }, position: { x: 250, y: 100 } }]);
  const [edges, setEdges] = useState(diagramData?.edges || []);

  const onNodesChange = useCallback((changes: any) => {
    setNodes((nds: any) => {
      const updated = [...nds];
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const idx = updated.findIndex((n: any) => n.id === change.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], position: change.position };
        }
      });
      return updated;
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-zinc-950 flex flex-col animate-in fade-in duration-300">
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0 z-10 bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-4"><Button variant="ghost" onClick={onClose}><X size={20} /></Button><span className="font-bold flex items-center gap-2"><Layout size={18} className="text-indigo-500" /> Architecture Editor</span></div>
        <Button variant="accent" onClick={onClose}><Save size={16} /> Save Diagram</Button>
      </header>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          fitView
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
};

const WhiteboardEditor: React.FC<{ onClose: () => void; style: 'clean' | 'sketchy' }> = ({ onClose, style }) => (
  <div className="fixed inset-0 z-[100] bg-white dark:bg-zinc-950 flex flex-col animate-in slide-in-from-bottom duration-300">
    <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 shrink-0 z-10 bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-4"><Button variant="ghost" onClick={onClose}><X size={20} /></Button><span className="font-bold flex items-center gap-2"><Box size={18} className="text-amber-500" /> Whiteboard ({style})</span></div>
      <Button variant="accent" onClick={onClose}><Save size={16} /> Save</Button>
    </header>
    <div className="flex-1 tldraw__editor"><Tldraw /></div>
  </div>
);
