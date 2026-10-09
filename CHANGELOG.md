# Changelog

## Unreleased

- Fixed: drift no longer flags a doc when another file's same-named symbol changes. Hayvenhurst symbol anchors now resolve to the node in the anchored file, and fall back to git-diff when there's no such node (CAT-5).
