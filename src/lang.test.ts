import { describe, expect, test } from "bun:test";

import { compatibleFamilies, languageFamily, sameLanguage } from "./lang";

describe("language families (CAT-10 cross-language edge guard)", () => {
  test("extensions map to families, case-insensitively", () => {
    expect(languageFamily("crates/db/src/lib.rs")).toBe("rust");
    expect(languageFamily("apps/field/src/router.tsx")).toBe("js");
    expect(languageFamily("a/b.MJS")).toBe("js");
    expect(languageFamily("web/App.vue")).toBe("js");
    expect(languageFamily("tools/x.py")).toBe("python");
    expect(languageFamily("src\\win\\x.ts")).toBe("js");
  });

  test("unknown or missing extensions are null", () => {
    expect(languageFamily("migrations/0004_ledger.sql")).toBeNull();
    expect(languageFamily("Makefile")).toBeNull();
    expect(languageFamily("src/.env")).toBeNull();
    expect(languageFamily("dir.d/noext")).toBeNull();
  });

  test("different families are incompatible; unknown and FFI pairs are kept", () => {
    expect(sameLanguage("crates/db/src/lib.rs", "apps/dash/src/useWorkActions.ts")).toBe(false);
    expect(sameLanguage("a.ts", "b.jsx")).toBe(true);
    expect(sameLanguage("a.py", "b.rs")).toBe(false);
    expect(sameLanguage("a.rs", "b.sql")).toBe(true); // unknown → keep the edge
    expect(compatibleFamilies("rust", "c")).toBe(true);
    expect(compatibleFamilies("c", "swift")).toBe(true);
    expect(compatibleFamilies("js", "c")).toBe(false);
    expect(compatibleFamilies(null, "rust")).toBe(true);
  });
});
