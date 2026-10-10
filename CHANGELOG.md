# Changelog

## Unreleased

- Added: community health files (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY), issue and PR templates including a "Drift got it wrong" report, CI and license badges and a Sothis suite link in the README, and GitHub Discussions for questions (CAT-9).
- Fixed: a dependency in an incompatible language no longer drifts a doc. When Hayvenhurst reports a call across language families (e.g. Rust `migrate` → TS `close`, a bare-name edge), drift ignores it. Unknown extensions are kept, and C, Rust, Swift and Go count as one C-ABI group. Known costs: real bindings outside that group (PyO3, napi, JNI, …) no longer drift a doc on the Hayvenhurst path, and a bogus same-name edge inside it still does. This guards Catryna until Hayvenhurst fixes the edges upstream (HAYV-18) (CAT-10).
- Fixed: drift no longer flags a doc when another file's same-named symbol changes. Hayvenhurst symbol anchors now resolve to the node in the anchored file, and fall back to git-diff when there's no such node. Every exact-name match among the top 200 `hayven query` hits is checked (CAT-5).
- Added: CI runs the full gate (backend + viewer typecheck, tests, doc lint, drift) on every push and PR, on macOS, Ubuntu and Windows (CAT-11).
