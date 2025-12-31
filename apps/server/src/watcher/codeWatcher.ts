import { watch } from 'chokidar'
import { EventEmitter } from 'events'
import { matchesGlob, hashContent } from '@catryna/shared'
import { getDb, watchedFiles } from '../db'
import { eq } from 'drizzle-orm'
import { readFile, stat } from 'fs/promises'

interface WatcherConfig {
  include: string[]
  exclude: string[]
  debounceMs: number
  rootDir?: string
}

interface WatcherEvents {
  change: (filePath: string) => void
  add: (filePath: string) => void
  unlink: (filePath: string) => void
  error: (error: Error) => void
}

export async function createFileWatcher(config: WatcherConfig): Promise<EventEmitter> {
  const emitter = new EventEmitter()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const rootDir = config.rootDir || process.cwd()

  // Initialize chokidar watcher
  const watcher = watch(config.include, {
    ignored: config.exclude,
    persistent: true,
    ignoreInitial: false,
    cwd: rootDir,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  })

  // Helper to debounce events
  function debounce(filePath: string, event: string) {
    const existing = debounceTimers.get(filePath)
    if (existing) {
      clearTimeout(existing)
    }

    debounceTimers.set(
      filePath,
      setTimeout(async () => {
        debounceTimers.delete(filePath)
        await handleFileEvent(filePath, event)
      }, config.debounceMs)
    )
  }

  // Handle file events
  async function handleFileEvent(filePath: string, event: string) {
    try {
      // Check if file matches any include pattern
      const matches = config.include.some((pattern) => matchesGlob(filePath, pattern))
      if (!matches) return

      // Check if file matches any exclude pattern
      const excluded = config.exclude.some((pattern) => matchesGlob(filePath, pattern))
      if (excluded) return

      const db = getDb()
      const fullPath = `${rootDir}/${filePath}`

      if (event === 'unlink') {
        // File was deleted
        await db.delete(watchedFiles).where(eq(watchedFiles.filePath, filePath))
        emitter.emit('unlink', filePath)
        return
      }

      // Get file stats and content
      const stats = await stat(fullPath)
      const content = await readFile(fullPath, 'utf-8')
      const contentHash = hashContent(content)

      // Check if we already have this file tracked
      const existing = await db.query.watchedFiles.findFirst({
        where: eq(watchedFiles.filePath, filePath),
      })

      if (existing) {
        // Check if content actually changed
        if (existing.contentHash === contentHash) {
          return // No actual change
        }

        // Update the tracked file
        await db
          .update(watchedFiles)
          .set({
            lastModified: stats.mtime,
            contentHash,
          })
          .where(eq(watchedFiles.id, existing.id))

        emitter.emit('change', filePath)
      } else {
        // New file
        await db.insert(watchedFiles).values({
          filePath,
          lastModified: stats.mtime,
          contentHash,
          relatedDocs: [],
        })

        emitter.emit('add', filePath)
      }
    } catch (error) {
      emitter.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  // Wire up chokidar events
  watcher
    .on('add', (path) => debounce(path, 'add'))
    .on('change', (path) => debounce(path, 'change'))
    .on('unlink', (path) => debounce(path, 'unlink'))
    .on('error', (error) => emitter.emit('error', error))

  // Add cleanup method
  ;(emitter as EventEmitter & { close: () => Promise<void> }).close = async () => {
    debounceTimers.forEach((timer) => clearTimeout(timer))
    debounceTimers.clear()
    await watcher.close()
  }

  return emitter
}

export type FileWatcher = EventEmitter & { close: () => Promise<void> }
