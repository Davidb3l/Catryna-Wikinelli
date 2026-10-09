---
name: Drift got it wrong
about: catryna drift flagged a doc that is still accurate, or missed one the code has outgrown.
title: "[drift] "
labels: bug
assignees: ''
---

<!--
A wrong drift verdict is usually explained by the doc's anchors, its baseline
commit, and what git says changed in between. Those three things are what this
template asks for. Drift reads committed history only, so commit your work
before reporting.
-->

## Which way was it wrong?

- [ ] False positive: reported drifted or broken, but the doc is still accurate
- [ ] False negative: reported clean, but the code has outgrown the doc

## The doc

- **Doc path** (e.g. `architecture/overview`):
- **Its `anchors` and `relatedFiles`** (from the `.mdx` frontmatter):
- **Its `verifiedCommit`**:

## What drift said

The doc's entry from `catryna drift --json`, including `status`, `precision`
and `changedFiles`.

```json
<paste here>
```

## What git says

For each anchored file, `git diff --stat <verifiedCommit> HEAD -- <file>`.

```
<paste here>
```

## Environment

- **Catryna version** (first line of `catryna doctor`):
- **Hayvenhurst installed?** (`hayven --version`, or "no"). With `precision: "hayven"`, symbol anchors are judged through its code graph.
- **OS**:
