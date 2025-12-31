import React, { useMemo } from 'react'
import * as Diff from 'diff'
import { usePreferences } from '@/lib/storage/preferences'

interface DiffViewerProps {
  oldContent: string
  newContent: string
  oldTitle?: string
  newTitle?: string
  language?: string
}

export function DiffViewer({
  oldContent,
  newContent,
  oldTitle = 'Previous',
  newTitle = 'Current',
  language,
}: DiffViewerProps) {
  const { preferences } = usePreferences()
  const viewMode = preferences.defaultDiffView

  const diff = useMemo(() => {
    if (viewMode === 'inline') {
      return Diff.diffLines(oldContent, newContent)
    }
    return Diff.diffLines(oldContent, newContent)
  }, [oldContent, newContent, viewMode])

  if (viewMode === 'inline') {
    return <InlineDiffView diff={diff} language={language} />
  }

  return (
    <SideBySideDiffView
      diff={diff}
      oldTitle={oldTitle}
      newTitle={newTitle}
      language={language}
    />
  )
}

interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

function InlineDiffView({
  diff,
  language,
}: {
  diff: DiffPart[]
  language?: string
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950">
      <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-mono text-zinc-500">
        Inline Diff
      </div>
      <pre className="p-4 font-mono text-sm overflow-x-auto">
        {diff.map((part, index) => {
          const lines = part.value.split('\n').filter((line, i, arr) => {
            // Keep all lines except the last empty one
            return i < arr.length - 1 || line !== ''
          })

          return lines.map((line, lineIndex) => (
            <div
              key={`${index}-${lineIndex}`}
              className={`${
                part.added
                  ? 'bg-green-950/30 text-green-400'
                  : part.removed
                  ? 'bg-red-950/30 text-red-400'
                  : 'text-zinc-400'
              }`}
            >
              <span className="inline-block w-6 text-right text-zinc-600 select-none mr-4">
                {part.added ? '+' : part.removed ? '-' : ' '}
              </span>
              {line || ' '}
            </div>
          ))
        })}
      </pre>
    </div>
  )
}

function SideBySideDiffView({
  diff,
  oldTitle,
  newTitle,
  language,
}: {
  diff: DiffPart[]
  oldTitle: string
  newTitle: string
  language?: string
}) {
  // Build parallel lines for side-by-side view
  const { leftLines, rightLines } = useMemo(() => {
    const left: Array<{ content: string; type: 'removed' | 'unchanged' | 'empty' }> = []
    const right: Array<{ content: string; type: 'added' | 'unchanged' | 'empty' }> = []

    for (const part of diff) {
      const lines = part.value.split('\n').filter((line, i, arr) => {
        return i < arr.length - 1 || line !== ''
      })

      if (part.removed) {
        for (const line of lines) {
          left.push({ content: line, type: 'removed' })
          right.push({ content: '', type: 'empty' })
        }
      } else if (part.added) {
        for (const line of lines) {
          left.push({ content: '', type: 'empty' })
          right.push({ content: line, type: 'added' })
        }
      } else {
        for (const line of lines) {
          left.push({ content: line, type: 'unchanged' })
          right.push({ content: line, type: 'unchanged' })
        }
      }
    }

    return { leftLines: left, rightLines: right }
  }, [diff])

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <div className="grid grid-cols-2">
        {/* Headers */}
        <div className="px-4 py-2 bg-red-950/30 border-b border-r border-zinc-800 text-xs font-mono text-red-400">
          {oldTitle}
        </div>
        <div className="px-4 py-2 bg-green-950/30 border-b border-zinc-800 text-xs font-mono text-green-400">
          {newTitle}
        </div>

        {/* Content */}
        <div className="bg-zinc-950 border-r border-zinc-800 overflow-x-auto">
          <pre className="font-mono text-sm">
            {leftLines.map((line, i) => (
              <div
                key={i}
                className={`px-4 py-0.5 ${
                  line.type === 'removed'
                    ? 'bg-red-950/30 text-red-400'
                    : line.type === 'empty'
                    ? 'bg-zinc-900/50 text-transparent'
                    : 'text-zinc-400'
                }`}
              >
                <span className="inline-block w-8 text-right text-zinc-600 select-none mr-2">
                  {line.type !== 'empty' ? i + 1 : ''}
                </span>
                {line.content || ' '}
              </div>
            ))}
          </pre>
        </div>
        <div className="bg-zinc-950 overflow-x-auto">
          <pre className="font-mono text-sm">
            {rightLines.map((line, i) => (
              <div
                key={i}
                className={`px-4 py-0.5 ${
                  line.type === 'added'
                    ? 'bg-green-950/30 text-green-400'
                    : line.type === 'empty'
                    ? 'bg-zinc-900/50 text-transparent'
                    : 'text-zinc-400'
                }`}
              >
                <span className="inline-block w-8 text-right text-zinc-600 select-none mr-2">
                  {line.type !== 'empty' ? i + 1 : ''}
                </span>
                {line.content || ' '}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  )
}

// Export a simpler diff utility for comparing blocks
export function diffBlocks(
  oldBlocks: Array<{ id: string; type: string; data: unknown }>,
  newBlocks: Array<{ id: string; type: string; data: unknown }>
): {
  added: string[]
  removed: string[]
  modified: string[]
  unchanged: string[]
} {
  const oldIds = new Set(oldBlocks.map((b) => b.id))
  const newIds = new Set(newBlocks.map((b) => b.id))

  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  const unchanged: string[] = []

  // Find added blocks
  for (const block of newBlocks) {
    if (!oldIds.has(block.id)) {
      added.push(block.id)
    }
  }

  // Find removed and modified blocks
  for (const oldBlock of oldBlocks) {
    if (!newIds.has(oldBlock.id)) {
      removed.push(oldBlock.id)
    } else {
      const newBlock = newBlocks.find((b) => b.id === oldBlock.id)
      if (newBlock && JSON.stringify(oldBlock.data) !== JSON.stringify(newBlock.data)) {
        modified.push(oldBlock.id)
      } else {
        unchanged.push(oldBlock.id)
      }
    }
  }

  return { added, removed, modified, unchanged }
}
