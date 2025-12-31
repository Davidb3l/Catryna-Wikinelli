/**
 * DragonflyDB/Redis cache layer for Catryna Wikinelli
 * Used for caching rendered documentation, search results, and pub/sub for live updates
 */

interface CacheConfig {
  url: string
  prefix?: string
  defaultTTL?: number
}

interface CacheClient {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  del(key: string): Promise<void>
  publish(channel: string, message: string): Promise<void>
  subscribe(channel: string, handler: (message: string) => void): Promise<void>
  invalidate(pattern: string): Promise<void>
}

// In-memory cache for local mode (no DragonflyDB)
const memoryCache = new Map<string, { value: unknown; expires: number }>()

function createMemoryCache(config: CacheConfig): CacheClient {
  const prefix = config.prefix || 'catryna:'
  const defaultTTL = config.defaultTTL || 300 // 5 minutes

  const subscribers = new Map<string, Set<(message: string) => void>>()

  // Cleanup expired entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryCache.entries()) {
      if (entry.expires < now) {
        memoryCache.delete(key)
      }
    }
  }, 60000) // Every minute

  return {
    async get<T>(key: string): Promise<T | null> {
      const fullKey = prefix + key
      const entry = memoryCache.get(fullKey)

      if (!entry) return null
      if (entry.expires < Date.now()) {
        memoryCache.delete(fullKey)
        return null
      }

      return entry.value as T
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      const fullKey = prefix + key
      const expires = Date.now() + (ttl || defaultTTL) * 1000
      memoryCache.set(fullKey, { value, expires })
    },

    async del(key: string): Promise<void> {
      const fullKey = prefix + key
      memoryCache.delete(fullKey)
    },

    async publish(channel: string, message: string): Promise<void> {
      const handlers = subscribers.get(channel)
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message)
          } catch (error) {
            console.error(`Error in subscriber for ${channel}:`, error)
          }
        }
      }
    },

    async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
      if (!subscribers.has(channel)) {
        subscribers.set(channel, new Set())
      }
      subscribers.get(channel)!.add(handler)
    },

    async invalidate(pattern: string): Promise<void> {
      const regex = new RegExp(
        '^' + prefix + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      )
      for (const key of memoryCache.keys()) {
        if (regex.test(key)) {
          memoryCache.delete(key)
        }
      }
    },
  }
}

// DragonflyDB/Redis client (for server mode)
async function createDragonflyCache(config: CacheConfig): Promise<CacheClient> {
  // In a real implementation, this would use a Redis/Dragonfly client
  // For now, we fall back to memory cache
  console.log('[Cache] DragonflyDB URL:', config.url)
  console.log('[Cache] Falling back to memory cache (implement Redis client for production)')

  return createMemoryCache(config)
}

// Cache singleton
let cacheInstance: CacheClient | null = null

export async function getCache(): Promise<CacheClient> {
  if (cacheInstance) return cacheInstance

  const isLocal = process.env.CATRYNA_MODE === 'local'
  const cacheUrl = process.env.DRAGONFLY_URL || 'redis://localhost:6379'

  if (isLocal) {
    cacheInstance = createMemoryCache({
      url: 'memory',
      prefix: 'catryna:',
      defaultTTL: 300,
    })
  } else {
    cacheInstance = await createDragonflyCache({
      url: cacheUrl,
      prefix: 'catryna:',
      defaultTTL: 300,
    })
  }

  return cacheInstance
}

// Cache keys
export const cacheKeys = {
  doc: (path: string) => `doc:${path}`,
  docList: (filter?: string) => `docs:${filter || 'all'}`,
  search: (query: string) => `search:${query}`,
  coverage: () => 'coverage',
  renderedBlock: (docPath: string, blockId: string) => `rendered:${docPath}:${blockId}`,
}

// Cache channels for pub/sub
export const cacheChannels = {
  docChanged: 'doc:changed',
  regeneration: 'regeneration:status',
}
