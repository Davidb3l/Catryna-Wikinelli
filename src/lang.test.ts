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

  test("different families are incompatible; unknown and C-ABI families are kept", () => {
    expect(sameLanguage("crates/db/src/lib.rs", "apps/dash/src/useWorkActions.ts")).toBe(false);
    expect(sameLanguage("a.ts", "b.jsx")).toBe(true);
    expect(sameLanguage("a.py", "b.rs")).toBe(false);
    expect(sameLanguage("a.rs", "b.sql")).toBe(true); // unknown → keep the edge
    expect(compatibleFamilies("rust", "c")).toBe(true);
    expect(compatibleFamilies("c", "swift")).toBe(true);
    expect(compatibleFamilies("js", "c")).toBe(false);
    expect(compatibleFamilies(null, "rust")).toBe(true);
  });

  test("the C-ABI group is one class: Swift↔Rust and Go↔Rust hold without a C hop", () => {
    expect(compatibleFamilies("swift", "rust")).toBe(true);
    expect(compatibleFamilies("go", "rust")).toBe(true);
    expect(compatibleFamilies("go", "swift")).toBe(true);
    // Bindings outside the group are deliberately dropped until HAYV-18.
    expect(compatibleFamilies("python", "rust")).toBe(false);
    expect(compatibleFamilies("js", "rust")).toBe(false);
  });

  test(".m is read as Objective-C, so it doesn't become a wildcard", () => {
    expect(languageFamily("app/AppDelegate.m")).toBe("c");
    expect(languageFamily("app/Bridge.mm")).toBe("c");
    expect(sameLanguage("ios/AppDelegate.m", "src/close.ts")).toBe(false);
  });
});
