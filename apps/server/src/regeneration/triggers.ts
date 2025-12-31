import { exec } from 'child_process'
import { promisify } from 'util'
import { getDb, regenerationQueue } from '../db'

const execAsync = promisify(exec)

interface GitHookConfig {
  enabled: boolean
  regenerate: boolean
  commitDocs: boolean
}

/**
 * Git hook handler for post-receive hook
 * Called when commits are pushed to the repository
 */
export async function handlePostReceive(
  oldSha: string,
  newSha: string,
  ref: string,
  config: GitHookConfig
): Promise<{ changedFiles: string[]; queued: number }> {
  if (!config.enabled || !config.regenerate) {
    return { changedFiles: [], queued: 0 }
  }

  // Get list of changed files between commits
  const { stdout } = await execAsync(`git diff --name-only ${oldSha} ${newSha}`)
  const changedFiles = stdout
    .trim()
    .split('\n')
    .filter((f) => f.length > 0)

  // Filter for source files we care about
  const sourceFiles = changedFiles.filter(
    (f) =>
      f.match(/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp)$/) &&
      !f.includes('node_modules') &&
      !f.includes('.test.') &&
      !f.includes('.spec.')
  )

  if (sourceFiles.length === 0) {
    return { changedFiles: [], queued: 0 }
  }

  // Queue regeneration for each changed file
  const db = getDb()
  for (const filePath of sourceFiles) {
    await db.insert(regenerationQueue).values({
      filePath,
      status: 'pending',
    })
  }

  return {
    changedFiles: sourceFiles,
    queued: sourceFiles.length,
  }
}

/**
 * Get the diff between two commits
 */
export async function getGitDiff(
  oldSha: string,
  newSha: string,
  filePath?: string
): Promise<string> {
  const fileArg = filePath ? `-- ${filePath}` : ''
  const { stdout } = await execAsync(`git diff ${oldSha} ${newSha} ${fileArg}`)
  return stdout
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD')
  return stdout.trim()
}

/**
 * Get the current commit SHA
 */
export async function getCurrentCommit(): Promise<string> {
  const { stdout } = await execAsync('git rev-parse HEAD')
  return stdout.trim()
}

/**
 * Commit documentation changes (if enabled)
 */
export async function commitDocChanges(
  message: string,
  config: GitHookConfig
): Promise<string | null> {
  if (!config.commitDocs) {
    return null
  }

  try {
    // Stage docs changes
    await execAsync('git add docs/ .catryna/')

    // Check if there are changes to commit
    const { stdout: status } = await execAsync('git status --porcelain docs/ .catryna/')
    if (!status.trim()) {
      return null // No changes to commit
    }

    // Commit changes
    await execAsync(`git commit -m "${message}"`)

    // Get the new commit SHA
    const { stdout: sha } = await execAsync('git rev-parse HEAD')
    return sha.trim()
  } catch (error) {
    console.error('Failed to commit doc changes:', error)
    return null
  }
}

/**
 * Script to install git hooks
 */
export function getGitHookScript(): string {
  return `#!/bin/sh
# Catryna Wikinelli post-receive hook
# Triggers documentation regeneration when code is pushed

while read oldrev newrev refname
do
  curl -X POST http://localhost:4000/hooks/post-receive \\
    -H "Content-Type: application/json" \\
    -d "{\\"oldSha\\": \\"$oldrev\\", \\"newSha\\": \\"$newrev\\", \\"ref\\": \\"$refname\\"}"
done
`
}
