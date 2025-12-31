import React, { useState } from 'react'
import {
  Terminal,
  Copy,
  ExternalLink,
  Info,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Layout,
  Box,
  GripVertical,
  Trash2,
  Activity,
  Share2,
  Edit3,
  Maximize2,
} from 'lucide-react'
import { resolveToEditorUrl, resolveToGitHubUrl } from '@catryna/shared'

interface Block {
  id: string
  type: string
  data: any
}

interface BlockRendererProps {
  block: Block
  isEditing: boolean
  showLineNumbers: boolean
  whiteboardStyle: 'clean' | 'sketchy'
  onDelete?: (id: string) => void
}

export function BlockRenderer({
  block,
  isEditing,
  showLineNumbers,
  whiteboardStyle,
  onDelete,
}: BlockRendererProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const wrapper = (children: React.ReactNode) => (
    <div className="group relative">
      {isEditing && (
        <div className="absolute -left-12 top-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded cursor-grab">
            <GripVertical size={14} className="text-zinc-300" />
          </div>
          {onDelete && (
            <button
              onClick={() => onDelete(block.id)}
              className="p-1 hover:bg-red-50 text-red-400 rounded"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )

  // Text block
  if (block.type === 'text') {
    return wrapper(
      <div
        contentEditable={isEditing}
        className="leading-relaxed text-zinc-700 dark:text-zinc-300 min-h-[1.5em] outline-none py-1.5 focus:bg-zinc-50 dark:focus:bg-zinc-900 transition-colors"
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: block.data.content }}
      />
    )
  }

  // Heading block
  if (block.type === 'heading') {
    const level = block.data.level || 1
    const sizes = {
      1: 'text-3xl font-black',
      2: 'text-2xl font-bold',
      3: 'text-xl font-bold',
      4: 'text-lg font-semibold',
      5: 'text-base font-semibold',
      6: 'text-sm font-semibold',
    }
    return wrapper(
      <div
        contentEditable={isEditing}
        className={`${sizes[level as keyof typeof sizes]} mt-8 mb-4 outline-none text-zinc-900 dark:text-zinc-50 border-b-2 border-transparent focus:border-indigo-500/20`}
        suppressContentEditableWarning
      >
        {block.data.content}
      </div>
    )
  }

  // Code block
  if (block.type === 'code') {
    const lines = (block.data.content || '').split('\n')
    return wrapper(
      <div className="my-6 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 shadow-2xl group/code">
        <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
          <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-2 uppercase tracking-widest font-bold">
            <Terminal size={12} />
            {block.data.language || 'code'}
          </span>
          <div className="flex gap-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
            <button
              onClick={() => handleCopy(block.data.content)}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <div className="flex bg-zinc-950">
          {showLineNumbers && (
            <div className="w-10 bg-zinc-900/40 border-r border-zinc-800 p-4 text-right text-zinc-700 font-mono text-xs select-none leading-relaxed">
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <pre className="flex-1 p-4 font-mono text-sm bg-transparent text-zinc-300 overflow-x-auto leading-relaxed">
            <code>{block.data.content}</code>
          </pre>
        </div>
      </div>
    )
  }

  // Code embed block
  if (block.type === 'code-embed') {
    const { filePath, startLine, endLine, language, content } = block.data
    const editorUrl = resolveToEditorUrl(filePath, 'vscode', [startLine, endLine])

    return wrapper(
      <div className="my-6 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 shadow-2xl group/code">
        <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
          <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-2">
            <Terminal size={12} />
            {filePath} ({startLine}-{endLine})
          </span>
          <div className="flex gap-2 opacity-0 group-hover/code:opacity-100 transition-opacity">
            <button
              onClick={() => handleCopy(content || '')}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white"
            >
              <Copy size={12} />
            </button>
            <a
              href={editorUrl}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <pre className="p-4 font-mono text-sm text-zinc-300 overflow-x-auto leading-relaxed">
          <code>{content || `// Loading ${filePath}...`}</code>
        </pre>
      </div>
    )
  }

  // Callout block
  if (block.type === 'callout') {
    const variants = {
      info: { icon: Info, bg: 'bg-blue-50 dark:bg-blue-950/20', border: 'border-blue-200 dark:border-blue-900', iconColor: 'text-blue-500' },
      warning: { icon: AlertTriangle, bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-200 dark:border-amber-900', iconColor: 'text-amber-500' },
      error: { icon: AlertCircle, bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-200 dark:border-red-900', iconColor: 'text-red-500' },
      success: { icon: CheckCircle, bg: 'bg-green-50 dark:bg-green-950/20', border: 'border-green-200 dark:border-green-900', iconColor: 'text-green-500' },
      note: { icon: Info, bg: 'bg-indigo-50 dark:bg-indigo-950/20', border: 'border-indigo-200 dark:border-indigo-900', iconColor: 'text-indigo-500' },
    }
    const variant = variants[block.data.variant as keyof typeof variants] || variants.note
    const Icon = variant.icon

    return wrapper(
      <div className={`p-4 rounded-xl border flex gap-4 my-4 ${variant.bg} ${variant.border}`}>
        <Icon size={18} className={`${variant.iconColor} shrink-0 mt-0.5`} />
        <div>
          {block.data.title && (
            <div className="font-bold text-sm mb-1">{block.data.title}</div>
          )}
          <div
            contentEditable={isEditing}
            className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 outline-none"
            suppressContentEditableWarning
          >
            {block.data.content}
          </div>
        </div>
      </div>
    )
  }

  // React Flow diagram block
  if (block.type === 'react-flow') {
    return wrapper(
      <div className="my-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 p-12 flex flex-col items-center justify-center transition-all hover:border-indigo-500/30 min-h-[300px] group/item shadow-inner">
        <div className="px-3 py-1 bg-white dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-6 flex items-center gap-2 shadow-sm">
          <Layout size={12} className="text-indigo-500" />
          Architecture Diagram
        </div>
        <Activity size={40} className="text-zinc-200 dark:text-zinc-800 mb-6" />
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <Maximize2 size={14} /> Open Diagram Editor
        </button>
      </div>
    )
  }

  // Whiteboard block
  if (block.type === 'whiteboard') {
    return wrapper(
      <div
        className={`my-8 rounded-2xl border-2 ${
          whiteboardStyle === 'sketchy'
            ? 'border-dashed border-zinc-200'
            : 'border-zinc-100 dark:border-zinc-800'
        } bg-white dark:bg-zinc-950 p-12 min-h-[400px] flex flex-col items-center justify-center group/item shadow-sm`}
      >
        <div className="px-3 py-1 bg-zinc-50 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase mb-6 flex items-center gap-2">
          <Box size={12} className="text-amber-500" />
          Whiteboard ({whiteboardStyle})
        </div>
        <Share2 size={40} className="text-zinc-100 dark:text-zinc-900 mb-6" />
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <Edit3 size={14} /> Launch Whiteboard
        </button>
      </div>
    )
  }

  // Mermaid block
  if (block.type === 'mermaid') {
    return wrapper(
      <div className="my-6 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        <div className="text-xs text-zinc-500 mb-2">Mermaid Diagram</div>
        <pre className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
          {block.data.content}
        </pre>
      </div>
    )
  }

  // Table block
  if (block.type === 'table') {
    return wrapper(
      <div className="my-6 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {(block.data.headers || []).map((header: string, i: number) => (
                <th
                  key={i}
                  className="px-4 py-2 text-left text-sm font-bold bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(block.data.rows || []).map((row: string[], i: number) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="px-4 py-2 text-sm border border-zinc-200 dark:border-zinc-700"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {block.data.caption && (
          <div className="text-xs text-zinc-500 mt-2 text-center">{block.data.caption}</div>
        )}
      </div>
    )
  }

  // Divider block
  if (block.type === 'divider') {
    return wrapper(
      <hr className="my-8 border-t border-zinc-200 dark:border-zinc-800" />
    )
  }

  // Unknown block type
  return wrapper(
    <div className="my-4 p-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-500">
      Unknown block type: {block.type}
    </div>
  )
}
