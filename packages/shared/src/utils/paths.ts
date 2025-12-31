import path from 'path'

/**
 * Normalize a doc path to consistent format
 */
export function normalizeDocPath(docPath: string): string {
  return docPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/**
 * Get parent path from a doc path
 */
export function getParentPath(docPath: string): string | null {
  const normalized = normalizeDocPath(docPath)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return null
  return normalized.slice(0, lastSlash)
}

/**
 * Get the base name from a path
 */
export function getBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

/**
 * Check if a path matches a glob pattern (simple implementation)
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLE_STAR>>>/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\./g, '\\.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filePath.replace(/\\/g, '/'))
}

/**
 * Resolve code link to external URL
 */
export function resolveToGitHubUrl(
  filePath: string,
  options: {
    owner: string
    repo: string
    branch: string
    lines?: [number, number]
  }
): string {
  const { owner, repo, branch, lines } = options
  let url = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`

  if (lines) {
    url += `#L${lines[0]}`
    if (lines[1] !== lines[0]) {
      url += `-L${lines[1]}`
    }
  }

  return url
}

/**
 * Resolve code link to VS Code URL
 */
export function resolveToEditorUrl(
  filePath: string,
  scheme: 'vscode' | 'cursor' | 'idea',
  lines?: [number, number]
): string {
  const schemes = {
    vscode: 'vscode://file',
    cursor: 'cursor://file',
    idea: 'idea://open?file',
  }

  let url = `${schemes[scheme]}/${filePath}`

  if (lines && scheme !== 'idea') {
    url += `:${lines[0]}`
  } else if (lines && scheme === 'idea') {
    url += `&line=${lines[0]}`
  }

  return url
}
