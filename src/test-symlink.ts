/**
 * Symlinks in tests, portably.
 *
 * Windows only lets a process create a symlink with the SeCreateSymbolicLink
 * privilege — Developer Mode or an elevated shell. CI's windows-latest runner
 * has it; an ordinary Windows contributor usually doesn't, so a bare
 * `symlink()` in a test failed with EPERM on their machine and nowhere else.
 *
 * - A DIRECTORY link uses a junction on Windows. Junctions need no privilege,
 *   and `realpath` resolves them like a symlink, so a containment test still
 *   exercises the real escape.
 * - A FILE link has no unprivileged equivalent (a hard link is not something
 *   `realpath` can see through). Tests that need one gate on `canSymlinkFiles`
 *   with `test.skipIf`, so a host without the privilege reports them SKIPPED —
 *   never silently passing.
 */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Link `path` → the directory `target`. Works unprivileged on every OS. */
export async function symlinkDir(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

/** Link `path` → the file `target`. Gate the test on `canSymlinkFiles`. */
export async function symlinkFile(target: string, path: string): Promise<void> {
  await symlink(target, path, "file");
}

async function probeFileSymlinks(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const dir = await mkdtemp(join(tmpdir(), "catryna-symlink-probe-"));
  try {
    await writeFile(join(dir, "t"), "");
    await symlink(join(dir, "t"), join(dir, "l"), "file");
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
    console.warn(
      "[test-symlink] this Windows host cannot create file symlinks (enable Developer Mode " +
        "to run them); file-symlink tests are SKIPPED here and still run in CI.",
    );
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether this host can create a file symlink (false only on unprivileged Windows). */
export const canSymlinkFiles: boolean = await probeFileSymlinks();
