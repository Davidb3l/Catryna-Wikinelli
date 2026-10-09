/**
 * Language families by file extension, for one question: can code in file A
 * plausibly call code in file B in-process?
 *
 * Drift uses it to discard impossible dependency edges. Hayvenhurst links calls
 * by bare name, so a Rust `migrate` can appear to call a TypeScript `close`
 * (CAT-10, upstream HAYV-18). That edge cannot be real, and a change on its far
 * side must not drift a doc anchored to the Rust symbol.
 *
 * This is a guard, not a model of interop, and it has a known cost. Two
 * families count as compatible when they are the same, when either is unknown
 * (an extension missing from the table keeps its edges), or when both are in
 * the C-ABI group (C, Rust, Swift, Go), which call each other through the C ABI
 * directly or via a C shim. Every other pair is treated as unable to call each
 * other, so REAL bindings between them (Python↔Rust via PyO3, JS↔Rust via
 * napi/wasm, Python↔C extensions, JNI, P/Invoke, Dart FFI, …) no longer drift
 * a doc on the Hayvenhurst path. They return once Hayvenhurst resolves call
 * edges properly (HAYV-18) and this guard can go.
 */

const FAMILIES: Record<string, readonly string[]> = {
  js: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro"],
  rust: ["rs"],
  python: ["py", "pyi"],
  go: ["go"],
  jvm: ["java", "kt", "kts", "scala", "groovy"],
  dotnet: ["cs", "fs", "vb"],
  // Not `.m`: it is Objective-C or MATLAB, so it stays unknown (keeps its edges).
  c: ["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "mm"],
  swift: ["swift"],
  ruby: ["rb"],
  php: ["php"],
  dart: ["dart"],
};

const FAMILY_BY_EXT = new Map<string, string>(
  Object.entries(FAMILIES).flatMap(([family, exts]) => exts.map((e) => [e, family] as const)),
);

/**
 * Families that call each other through the C ABI. One group, not pairs, so the
 * relation is transitive: a Swift app calling a Rust core through a C shim is a
 * chain Swift → C → Rust, and drift compares only its two ends.
 */
const C_ABI = new Set(["c", "rust", "swift", "go"]);

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
  return C_ABI.has(a) && C_ABI.has(b);
}

/** Whether code in file `a` can plausibly call code in file `b`. */
export function sameLanguage(a: string, b: string): boolean {
  return compatibleFamilies(languageFamily(a), languageFamily(b));
}
