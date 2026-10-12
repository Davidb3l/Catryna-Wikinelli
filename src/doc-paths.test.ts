/**
 * Doc paths name files INSIDE `.docs/`, and nowhere else.
 *
 * A doc path reaches storage from MCP tool arguments (create_doc, update_doc,
 * get_doc, delete_doc, the diagram tools) and from `_index.json`, a git-shared
 * cache. `resolveDocFile` is the one place either becomes a filesystem path, so
 * these tests drive every operation with every invalid form and assert two
 * things: the operation refuses, and nothing outside `.docs/` was read,
 * written, created or unlinked.
 *
 * Storage resolves `.docs/` from `process.cwd()` captured at module load, so
 * each scenario runs in a subprocess whose cwd is a fresh temp project. Layout:
 *
 *     <base>/proj/.docs/   the project's docs
 *     <base>/outside/      a sibling holding canary files that must survive
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, linkSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidDocPathError, resolveDocFile, validateDocPath } from "./storage";
import { lintDocFile, lintDocs } from "./lint";
import { runConsume } from "./consume";
import { buildRepairContext } from "./tools/drift";
import { canSymlinkFiles, symlinkDir, symlinkFile } from "./test-symlink";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));
const INDEX_PATH = fileURLToPath(new URL("./index.ts", import.meta.url));
const CANARY = "CANARY-7f3e-outside-docs";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Every form the containment must refuse, on every OS. Grouped as the ticket
// lists them; a few are only dangerous on Windows, but `.docs/` is git-shared,
// so a path one OS could write would still break another's checkout.
const INVALID: Record<string, string> = {
  "empty": "",
  "parent traversal": "../escaped",
  "double parent traversal": "../../escaped",
  "traversal mid-path": "modules/../../escaped",
  "dot segment": "modules/./auth",
  "empty segment": "modules//auth",
  "trailing slash": "modules/",
  "absolute POSIX": "/tmp/escaped",
  "absolute, double slash (UNC-ish)": "//server/share/escaped",
  "NUL byte": "modules/auth\0.txt",
  "control character": "modules/a\nb",
  "backslash traversal": "..\\escaped",
  "backslash mid-path": "modules\\..\\..\\escaped",
  "drive letter, slash": "C:/escaped",
  "drive letter, backslash": "C:\\escaped",
  "drive-relative": "C:escaped",
  "UNC": "\\\\server\\share\\escaped",
  "device namespace": "\\\\?\\C:\\escaped",
  "device namespace, dot": "\\\\.\\COM1",
  "NTFS stream": "modules/auth:secret",
  "reserved CON": "CON",
  "reserved nul, lowercase": "nul",
  "reserved COM1 in a folder": "modules/com1",
  "reserved with an extension": "lpt9.txt",
  "reserved folder": "aux/escaped",
  "reserved CONIN$": "CONIN$",
  "reserved superscript COM": "com¹",
  "trailing dot": "modules/auth.",
  "trailing space": "modules/auth ",
  "trailing dot on a folder": "modules./auth",
  "wildcard": "modules/*",
  "question mark": "modules/a?",
  "pipe": "modules/a|b",
  "angle bracket": "modules/<a>",
  "double quote": 'modules/"a"',
  "reserved, space before the extension": "CON .txt",
};

// The counterweight: plain paths that must keep working, including names that
// merely START like a reserved device name.
const LEGIT = [
  "getting-started",
  "modules/auth",
  "a/b/c/d",
  "guides/v1.2-notes",
  "Mixed Case/With Space",
  "connect",
  "console/output",
  "com10",
  "nullable",
  "auxiliary/x",
  ".hidden/doc",
  "über/ñandú",
  "..notes",
  "guides/..notes",
  "...x",
];

describe("validateDocPath (text)", () => {
  for (const [name, form] of Object.entries(INVALID)) {
    test(`refuses ${name}: ${JSON.stringify(form)}`, () => {
      expect(() => validateDocPath(form)).toThrow(InvalidDocPathError);
    });
  }
  test("accepts ordinary doc paths", () => {
    for (const p of LEGIT) expect(() => validateDocPath(p)).not.toThrow();
  });
});

interface Layout {
  base: string;
  proj: string;
  docs: string;
  outside: string;
}

/** A fresh `<base>/{proj/.docs, outside}` with canaries outside `.docs/`. */
async function layout(): Promise<Layout> {
  const base = await mkdtemp(join(tmpdir(), "catryna-docpaths-"));
  dirs.push(base);
  const proj = join(base, "proj");
  const docs = join(proj, ".docs");
  const outside = join(base, "outside");
  await mkdir(docs, { recursive: true });
  await mkdir(outside, { recursive: true });
  // Where the seeded index entries below point.
  await writeFile(join(proj, "canary.mdx"), CANARY);
  await writeFile(join(outside, "canary.mdx"), CANARY);
  return { base, proj, docs, outside };
}

/** Seed `_index.json` with one entry per path, bypassing every validator. */
async function seedIndex(l: Layout, paths: string[], extra: Record<string, unknown> = {}): Promise<void> {
  const docs = paths.map((p, i) => ({
    id: `seeded-${i}`,
    path: p,
    title: "seeded",
    tags: [],
    relatedFiles: [],
    anchors: [],
    evidence: [],
    refs: [],
    verifiedCommit: "",
    verifiedAt: "",
    driftSuspectSince: "",
    driftSuspectReason: "",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "test",
    ...extra,
  }));
  await writeFile(join(l.docs, "_index.json"), JSON.stringify({ version: 1, docs, lastUpdated: 1 }));
}

type OpResult = Record<"create" | "get" | "update" | "delete" | "verify" | "search", string>;

/**
 * In a subprocess with cwd = `l.proj`, run create/get/update/delete/verify on
 * each path and report each outcome: "ok", or the thrown error's name.
 */
async function runOps(l: Layout, paths: string[]): Promise<Record<string, OpResult>> {
  const pathsFile = join(l.base, "paths.json");
  await writeFile(pathsFile, JSON.stringify(paths));
  const fixture = join(l.base, "fixture.ts");
  await writeFile(
    fixture,
    `import * as S from ${JSON.stringify(STORAGE_PATH)};
import { readFileSync } from "node:fs";
const paths: string[] = JSON.parse(readFileSync(${JSON.stringify(pathsFile)}, "utf8"));
const out: Record<string, Record<string, string>> = {};
const attempt = async (f: () => Promise<unknown>) => {
  try { const r = await f(); return r === null || r === false ? "none" : "ok"; }
  catch (e) { return (e as Error).name; }
};
for (const p of paths) {
  out[p] = {
    get: await attempt(() => S.getDoc(p)),
    update: await attempt(() => S.updateDoc(p, { title: "overwritten", blocks: [{ type: "text", data: { content: "overwritten" } }] })),
    verify: await attempt(async () => (await S.recordVerification(p, "0".repeat(40), "2026-01-01T00:00:00.000Z")).meta),
    search: await attempt(async () => (await S.searchDocs(${JSON.stringify(CANARY)})).length ? true : null),
    delete: await attempt(() => S.deleteDoc(p)),
    create: await attempt(() => S.createDoc(p, "t", [{ type: "text", data: { content: "overwritten" } }])),
  };
}
console.log(JSON.stringify(out));
`,
  );
  const proc = Bun.spawn([process.execPath, "run", fixture], { cwd: l.proj, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`fixture exited ${code}: ${stderr}`);
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

/** Every file under the layout, relative, excluding the project's `.docs/` and `.suite/`. */
async function filesOutsideDocs(l: Layout): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === "proj/.docs" || r === "proj/.suite") continue; // the project's own stores
      if (e.isDirectory()) await walk(join(dir, e.name), r);
      else out.push(r);
    }
  }
  await walk(l.base, "");
  return out.sort();
}

/** The canaries are byte-identical and nothing new appeared outside `.docs/`. */
async function expectOutsideUntouched(l: Layout): Promise<void> {
  expect(await filesOutsideDocs(l)).toEqual(
    ["fixture.ts", "outside/canary.mdx", "paths.json", "proj/canary.mdx"].sort(),
  );
  expect(await readFile(join(l.proj, "canary.mdx"), "utf8")).toBe(CANARY);
  expect(await readFile(join(l.outside, "canary.mdx"), "utf8")).toBe(CANARY);
}

const REFUSED = "InvalidDocPathError";

describe("every operation refuses an invalid path, and touches nothing outside .docs/", () => {
  test("each form as a tool argument (no index entry)", async () => {
    const l = await layout();
    const forms = Object.values(INVALID);
    const results = await runOps(l, forms);
    for (const f of forms) {
      const r = results[f];
      // search takes no path; it must just not leak.
      expect({ path: f, ...r, search: undefined }).toEqual({
        path: f,
        create: REFUSED,
        get: REFUSED,
        update: REFUSED,
        delete: REFUSED,
        verify: REFUSED,
        search: undefined,
      });
    }
    await expectOutsideUntouched(l);
  }, 60_000);

  test("each form from a hand-edited _index.json, aimed at real canary files", async () => {
    const l = await layout();
    // `../canary` → proj/canary.mdx; `../../outside/canary` → outside/canary.mdx.
    const aimed = ["../canary", "../../outside/canary", "..\\canary", ...Object.values(INVALID)];
    await seedIndex(l, aimed);
    const results = await runOps(l, aimed);
    for (const p of aimed) {
      expect({ path: p, ...results[p] }).toMatchObject({
        path: p,
        get: REFUSED,
        update: REFUSED,
        delete: REFUSED,
        verify: REFUSED,
        create: REFUSED,
      });
      // searchDocs skips the entry rather than reading through it.
      expect(results[p].search).toBe("none");
    }
    await expectOutsideUntouched(l);
  }, 60_000);

  test("the legitimate paths still work end to end", async () => {
    const l = await layout();
    const results = await runOps(l, LEGIT);
    for (const p of LEGIT) {
      // Ops run get → update → verify → search → delete → create, so the doc
      // doesn't exist until the final create.
      expect({ path: p, ...results[p] }).toMatchObject({
        path: p,
        get: "none",
        update: "none",
        verify: "none",
        delete: "none",
        create: "ok",
      });
      expect(existsSync(join(l.docs, `${p}.mdx`))).toBe(true);
    }
    await expectOutsideUntouched(l);
  }, 60_000);
});

describe("links inside .docs/ cannot lead out of it", () => {
  test("a directory link (symlink, or a junction on unprivileged Windows) to outside", async () => {
    const l = await layout();
    await symlinkDir(l.outside, join(l.docs, "out"));
    await seedIndex(l, ["out/canary"]);
    const r = await runOps(l, ["out/canary", "out/new"]);
    expect(r["out/canary"]).toMatchObject({ get: REFUSED, update: REFUSED, delete: REFUSED, verify: REFUSED });
    expect(r["out/new"].create).toBe(REFUSED);
    expect(existsSync(join(l.outside, "new.mdx"))).toBe(false);
    await expectOutsideUntouched(l);
  }, 60_000);

  test("a directory link to a directory that doesn't exist yet", async () => {
    // realpath fails on the dangling link, so a walk that only realpaths would
    // fall back to the parent, find it inside, and let mkdir + writeFile follow
    // the link out.
    const l = await layout();
    await symlinkDir(join(l.outside, "later"), join(l.docs, "dangling"));
    const r = await runOps(l, ["dangling/new"]);
    expect(r["dangling/new"].create).toBe(REFUSED);
    expect(existsSync(join(l.outside, "later"))).toBe(false);
    await expectOutsideUntouched(l);
  }, 60_000);

  test.skipIf(!canSymlinkFiles)("a .mdx that is a symlink to a file outside", async () => {
    const l = await layout();
    await symlinkFile(join(l.outside, "canary.mdx"), join(l.docs, "link.mdx"));
    await seedIndex(l, ["link"]);
    const r = await runOps(l, ["link"]);
    expect(r.link).toMatchObject({ get: REFUSED, update: REFUSED, delete: REFUSED, verify: REFUSED, create: REFUSED });
    await expectOutsideUntouched(l);
  }, 60_000);

  test.skipIf(!canSymlinkFiles)("a dangling .mdx symlink is not written through", async () => {
    const l = await layout();
    await symlinkFile(join(l.outside, "created.mdx"), join(l.docs, "dangling.mdx"));
    const r = await runOps(l, ["dangling"]);
    expect(r.dangling.create).toBe(REFUSED);
    expect(existsSync(join(l.outside, "created.mdx"))).toBe(false);
    await expectOutsideUntouched(l);
  }, 60_000);
});

describe("the explicit-cwd callers (lint, consume, repair) share the guard", () => {
  test("resolveDocFile refuses traversal and links for any docs root", async () => {
    const l = await layout();
    await symlinkDir(l.outside, join(l.docs, "out"));
    await expect(resolveDocFile(l.docs, "../canary")).rejects.toThrow(InvalidDocPathError);
    await expect(resolveDocFile(l.docs, "out/canary")).rejects.toThrow(InvalidDocPathError);
    expect(await resolveDocFile(l.docs, "modules/auth")).toBe(join(l.docs, "modules", "auth.mdx"));
  });

  test("lint reports a bad index entry as invalid-path and never reads through it", async () => {
    const l = await layout();
    await seedIndex(l, ["../canary"]);
    const report = await lintDocs(l.proj);
    const issue = report.issues.find((i) => i.path === "../canary");
    expect(issue).toMatchObject({ rule: "invalid-path", severity: "error" });
    // Had lint read proj/canary.mdx, it would flag the canary's missing frontmatter.
    expect(report.issues.filter((i) => i.path === "../canary").map((i) => i.rule)).toEqual(["invalid-path"]);
    expect(await lintDocFile(l.proj, "../../outside/canary")).toMatchObject([{ rule: "invalid-path" }]);
  });

  test("consume marks a bad index entry in the index only, never writing through its path", async () => {
    // consume rewrites the frontmatter of every doc a code.changed event
    // touches; each path below would reach a canary if consume joined it raw.
    const l = await layout();
    await symlinkDir(l.outside, join(l.docs, "out"));
    await seedIndex(l, ["../canary", "out/canary"], { relatedFiles: ["src/a.ts"] });
    await mkdir(join(l.proj, ".suite", "events"), { recursive: true });
    const event = {
      v: 1,
      id: crypto.randomUUID(),
      ts: "2026-07-11T18:42:11.000Z",
      source: "hayven",
      type: "code.changed",
      refs: ["hayven:node/src/a.ts"],
      data: { files: ["src/a.ts"], symbols: [] },
    };
    await writeFile(join(l.proj, ".suite", "events", "2026-07-11.jsonl"), JSON.stringify(event) + "\n");
    // Canaries WITH a frontmatter block: a write-through would visibly add the
    // driftSuspect fields (a frontmatter-less file round-trips unchanged).
    const fmCanary = `---\ntitle: "canary"\n---\n\n${CANARY}\n`;
    await writeFile(join(l.proj, "canary.mdx"), fmCanary);
    await writeFile(join(l.outside, "canary.mdx"), fmCanary);

    const report = await runConsume({ cwd: l.proj, now: () => "2026-07-11T19:00:00.000Z" });
    expect(report.marked.map((m) => m.path).sort()).toEqual(["../canary", "out/canary"]);
    expect(await readFile(join(l.proj, "canary.mdx"), "utf8")).toBe(fmCanary);
    expect(await readFile(join(l.outside, "canary.mdx"), "utf8")).toBe(fmCanary);
  });

  test("repair never reads a bad index entry's path into its bundle", async () => {
    // A broken doc's bundle carries its current .mdx content; for these paths
    // that content would be a canary from beside .docs/.
    const l = await layout();
    await symlinkDir(l.outside, join(l.docs, "out"));
    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: l.proj });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.toString().trim();
    };
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const head = git("rev-parse", "HEAD");
    // Anchored to a file that doesn't exist, so drift reports both docs broken.
    await seedIndex(l, ["../canary", "out/canary"], { relatedFiles: ["src/gone.ts"], verifiedCommit: head });

    const r = await buildRepairContext(l.proj, "all");
    expect(r.repairs.map((x) => x.path).sort()).toEqual(["../canary", "out/canary"]);
    for (const x of r.repairs) expect(x.currentContent).toBe("");
  });
});

describe("hard links", () => {
  test("a doc file with a second hard link outside .docs/ is refused", async () => {
    // realpath can't see through a hard link: both names are equally "real".
    // Hard links need no privilege on NTFS, ext4 or APFS.
    const l = await layout();
    linkSync(join(l.outside, "canary.mdx"), join(l.docs, "hl.mdx"));
    await seedIndex(l, ["hl"]);
    const r = await runOps(l, ["hl"]);
    expect(r.hl).toMatchObject({ get: REFUSED, update: REFUSED, delete: REFUSED, verify: REFUSED, create: REFUSED });
    expect(await readFile(join(l.outside, "canary.mdx"), "utf8")).toBe(CANARY);
  }, 60_000);
});

describe("over MCP", () => {
  test("create/get/update/delete_doc refuse an invalid path with success:false, and write nothing", async () => {
    const l = await layout();
    // A hand-edited index entry, so get/update/delete would find a doc to act on.
    await seedIndex(l, ["../canary"]);
    const proc = Bun.spawn([process.execPath, "run", INDEX_PATH], {
      cwd: l.proj,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const calls: [number, string, Record<string, unknown>][] = [
      [2, "create_doc", { path: "../../escaped", title: "x", content: [{ type: "text", data: { content: "overwritten" } }] }],
      [3, "get_doc", { path: "../canary" }],
      [4, "update_doc", { path: "../canary", title: "overwritten" }],
      [5, "delete_doc", { path: "../canary" }],
      [6, "create_diagram", { path: "../../diagram", nodes: [], edges: [] }],
    ];
    for (const [id, name, args] of calls) {
      send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    }

    const replies = new Map<number, any>();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 20_000;
    while (replies.size < calls.length + 1 && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => ({ value: undefined, done: true })),
      ]);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (typeof msg.id === "number") replies.set(msg.id, msg);
      }
    }
    proc.stdin.end();
    proc.kill();
    await proc.exited;

    for (const [id, name] of calls) {
      const payload = JSON.parse(replies.get(id)?.result?.content?.[0]?.text ?? "null");
      expect({ tool: name, success: payload?.success }).toEqual({ tool: name, success: false });
      expect(payload.error).toContain("Invalid doc path");
    }
    expect(existsSync(join(l.base, "escaped.mdx"))).toBe(false);
    expect(existsSync(join(l.base, "diagram.mdx"))).toBe(false);
    expect(await readFile(join(l.proj, "canary.mdx"), "utf8")).toBe(CANARY);
  }, 30_000);
});
