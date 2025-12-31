/**
 * Simple hash function for content comparison
 * Uses FNV-1a algorithm for fast hashing
 */
export function hashContent(content: unknown): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content)
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619) // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Compare two hashes to check if content changed
 */
export function contentChanged(hash1: string, hash2: string): boolean {
  return hash1 !== hash2
}
