# Changelog

## Unreleased

- Fixed: a dependency in another language no longer drifts a doc. When Hayvenhurst reports a call across language families (e.g. Rust `migrate` → TS `close`, a bare-name edge), drift ignores it. Unknown extensions and C FFI pairs are kept. This guards Catryna until Hayvenhurst fixes the edges upstream (HAYV-18) (CAT-10).
- Fixed: drift no longer flags a doc when another file's same-named symbol changes. Hayvenhurst symbol anchors now resolve to the node in the anchored file, and fall back to git-diff when there's no such node. Every exact-name match among the top 200 `hayven query` hits is checked (CAT-5).
