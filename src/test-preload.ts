/**
 * Loaded before every test file (see bunfig.toml).
 *
 * Git exports GIT_DIR (and, for linked worktrees, a worktree-specific one) to
 * every hook it runs. The pre-push hook runs `bun run check`, so without this
 * every test that builds a throwaway repo with `git init` / `git config` /
 * `git commit` in a temp dir would inherit GIT_DIR and do all of that to the
 * repository being pushed instead: commits land on the pushed branch, the
 * index is replaced, and test settings (core.bare, user.*, diff.noprefix,
 * color.ui) are written into its .git/config. Strip every variable that
 * redirects repository discovery so tests only ever touch the repos they made.
 */
const REDIRECTING = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
];

for (const name of Object.keys(process.env)) {
  if (REDIRECTING.includes(name) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) {
    delete process.env[name];
  }
}

// Deleting from process.env is not enough on its own: Bun.spawn and
// Bun.spawnSync called WITHOUT an `env` option hand the child the process's
// ORIGINAL environment, ignoring those deletions (node:child_process does
// honor them). Default `env` to the cleaned process.env; an explicit `env`
// still wins. An explicit `env: undefined` counts as "not given" (Bun treats
// it the same as omitting it), so it gets the cleaned environment too.
type SpawnArgs = [cmdOrOptions: unknown, options?: Record<string, unknown>];
function withCleanEnv(args: SpawnArgs): SpawnArgs {
  const clean = (o: Record<string, unknown>): Record<string, unknown> => {
    const merged = { ...o };
    if (merged.env === undefined) merged.env = process.env;
    return merged;
  };
  const [first, options] = args;
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    return [clean(first as Record<string, unknown>)];
  }
  return [first, clean(options ?? {})];
}
const spawn = Bun.spawn;
const spawnSync = Bun.spawnSync;
const bun = Bun as unknown as Record<string, unknown>;
bun.spawn = (...args: SpawnArgs) =>
  (spawn as (...a: SpawnArgs) => unknown)(...withCleanEnv(args));
bun.spawnSync = (...args: SpawnArgs) =>
  (spawnSync as (...a: SpawnArgs) => unknown)(...withCleanEnv(args));
