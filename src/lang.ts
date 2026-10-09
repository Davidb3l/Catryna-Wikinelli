/**
 * Language families by file extension, for one question: can code in file A
 * plausibly call code in file B in-process?
 *
 * Drift uses it to discard impossible dependency edges. Hayvenhurst links calls
 * by bare name, so a Rust `migrate` can appear to call a TypeScript `close`
 * (CAT-10, upstream HAYV-18). That edge cannot be real, and a change on its far
 * side must not drift a doc anchored to the Rust symbol.
 *
 * This is a guard, not a model of interop. It errs toward keeping an edge: an
 * unknown extension is compatible with everything, and the common FFI pairs
 * (Rust/Swift/Go ↔ C) stay compatible, so a real dependency is never dropped
 * just because this table is incomplete.
 */

const FAMILIES: Record<string, readonly string[]> = {
  js: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro"],
  rust: ["rs"],
  python: ["py", "pyi"],
  go: ["go"],
  jvm: ["java", "kt", "kts", "scala", "groovy"],
  dotnet: ["cs", "fs", "vb"],
  c: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "m", "mm"],
  swift: ["swift"],
  ruby: ["rb"],
  php: ["php"],
  dart: ["dart"],
};

const FAMILY_BY_EXT = new Map<string, string>(
  Object.entries(FAMILIES).flatMap(([family, exts]) => exts.map((e) => [e, family] as const)),
);

/** Families that call each other through FFI, so their edges are kept. */
const INTEROP = new Set(["c|rust", "c|swift", "c|go"]);

/** The language family of `path`, or null when its extension isn't known. */
export function languageFamily(path: string): string | null {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return FAMILY_BY_EXT.get(base.slice(dot + 1).toLowerCase()) ?? null;
}

/**
 * Whether code in families `a` and `b` can call each other. Null (unknown) is
 * compatible with everything.
 */
export function compatibleFamilies(a: string | null, b: string | null): boolean {
  if (a === null || b === null || a === b) return true;
  return INTEROP.has(a < b ? `${a}|${b}` : `${b}|${a}`);
}

/** Whether code in file `a` can plausibly call code in file `b`. */
export function sameLanguage(a: string, b: string): boolean {
  return compatibleFamilies(languageFamily(a), languageFamily(b));
}
