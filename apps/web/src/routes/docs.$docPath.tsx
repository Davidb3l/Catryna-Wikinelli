import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useDoc, useDocVersions, useUpdateDoc, useRevertToVersion } from '@/lib/graphql/hooks'
import { usePreferences } from '@/lib/storage/preferences'
import {
  ChevronRight,
  Edit3,
  Save,
  History,
  X,
  RotateCcw,
} from 'lucide-react'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'

export function DocPage() {
  const { docPath } = useParams({ from: '/docs/$docPath' })
  const decodedPath = decodeURIComponent(docPath)
  const { data: doc, isLoading, error } = useDoc(decodedPath)
  const { data: versions } = useDocVersions(decodedPath)
  const { preferences } = usePreferences()
  const [isEditing, setIsEditing] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const updateDoc = useUpdateDoc()
  const revertToVersion = useRevertToVersion()

  const handleSave = async () => {
    if (!doc) return
    setIsSaving(true)
    try {
      await updateDoc.mutateAsync({
        path: decodedPath,
        input: {
          title: doc.title,
          blocks: doc.blocks.map((b: any) => ({ type: b.type, data: b.data })),
        },
      })
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRevert = async (versionId: string) => {
    try {
      await revertToVersion.mutateAsync({ docPath: decodedPath, versionId })
      setIsHistoryOpen(false)
    } catch (error) {
      console.error('Failed to revert:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-12">
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4 text-sm text-red-600 dark:text-red-400">
          Document not found: {decodedPath}
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-2 mt-4 text-indigo-500 hover:text-indigo-600 text-sm"
        >
          Go back to docs
        </Link>
      </div>
    )
  }

  const pathParts = decodedPath.split('/')

  return (
    <div className="flex justify-between max-w-6xl mx-auto px-4 sm:px-6 lg:px-12 py-6 sm:py-12 gap-6 lg:gap-12">
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 sm:gap-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-4 sm:mb-8 overflow-x-auto">
          <Link to="/" className="hover:text-indigo-500 shrink-0">
            Docs
          </Link>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <ChevronRight size={10} />
              <span className={i === pathParts.length - 1 ? 'text-zinc-900 dark:text-zinc-100' : ''}>
                {part}
              </span>
            </span>
          ))}
        </nav>

        {/* Title and Actions */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 sm:mb-10">
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 break-words">
            {doc.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="p-2.5 sm:p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Version history"
            >
              <History size={20} className="sm:w-[18px] sm:h-[18px]" />
            </button>
            {isEditing ? (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2.5 sm:py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 text-sm font-medium"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-4 py-2.5 sm:py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium"
              >
                <Edit3 size={16} />
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Content Blocks */}
        <div className="space-y-2">
          {doc.blocks.map((block: any) => (
            <BlockRenderer
              key={block.id}
              block={block}
              isEditing={isEditing}
              showLineNumbers={preferences.showLineNumbers}
              whiteboardStyle={preferences.whiteboardStyle}
            />
          ))}
        </div>

        {/* Metadata */}
        <div className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 space-y-1">
            <p>Created by: {doc.metadata?.createdBy || 'unknown'}</p>
            <p>Last updated: {new Date(doc.metadata?.updatedAt || doc.updatedAt).toLocaleString()}</p>
            {doc.metadata?.relatedFiles && doc.metadata.relatedFiles.length > 0 && (
              <div className="mt-2">
                <span>Related files: </span>
                <span className="font-mono break-all">{doc.metadata.relatedFiles.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table of Contents - Hidden on mobile */}
      <aside className="hidden xl:block w-48 sticky top-0 h-fit shrink-0">
        <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-4">
          On this page
        </div>
        <ul className="space-y-2.5">
          {doc.blocks
            .filter((b: any) => b.type === 'heading' && b.data?.level <= 2)
            .map((block: any) => (
              <li
                key={block.id}
                className={`text-xs cursor-pointer transition-colors ${
                  block.data.level === 1
                    ? 'font-bold text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 pl-3 hover:text-indigo-500'
                }`}
              >
                {block.data.content}
              </li>
            ))}
        </ul>
      </aside>

      {/* Version History Sidebar */}
      {isHistoryOpen && (
        <VersionHistorySidebar
          versions={versions || []}
          onClose={() => setIsHistoryOpen(false)}
          onRevert={handleRevert}
        />
      )}
    </div>
  )
}

function VersionHistorySidebar({
  versions,
  onClose,
  onRevert,
}: {
  versions: any[]
  onClose: () => void
  onRevert: (versionId: string) => void
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[140]"
        onClick={onClose}
      />
      {/* Sidebar */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-80 lg:w-[400px] z-[150] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
          <h3 className="font-bold flex items-center gap-2 text-sm sm:text-base">
            <History size={18} /> Version History
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {versions.length === 0 && (
            <div className="text-center py-10 text-zinc-400 text-sm">No versions found.</div>
          )}
          {versions.map((version) => (
            <div
              key={version.id}
              className="p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
            >
              <div className="flex justify-between items-start mb-2 gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">
                    {version.summary || 'Version update'}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {new Date(version.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[9px] font-bold text-zinc-500 uppercase shrink-0">
                  {version.createdBy || 'system'}
                </div>
              </div>
              <div className="text-[11px] font-mono text-zinc-500 mb-3">
                Hash: {version.contentHash?.slice(0, 8) || 'N/A'}
              </div>
              <button
                onClick={() => onRevert(version.id)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 transition-all"
              >
                <RotateCcw size={14} /> Revert to this version
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
