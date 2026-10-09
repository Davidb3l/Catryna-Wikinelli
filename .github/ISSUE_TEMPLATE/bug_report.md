---
name: Bug report
about: Something is broken in the Catryna MCP server, CLI, or docs viewer.
title: "[bug] "
labels: bug
assignees: ''
---

<!--
Thanks for taking the time to file a bug. The more concrete detail you can
give, the faster it can be reproduced. If drift reported the wrong verdict
for a doc, use the "Drift got it wrong" template instead.
-->

## Environment

- **Catryna version** (first line of `catryna doctor`):
- **Bun version** (`bun --version`):
- **OS + architecture** (`uname -a` on Unix, `systeminfo` on Windows):
- **How you run it** (Claude Code plugin / `.mcp.json` / CLI / viewer):

## What happened

A clear and concise description of the bug.

## Steps to reproduce

1.
2.
3.

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include exact error messages where possible.

## Output

The relevant output of the failing command (`catryna doctor`, `catryna lint`,
the MCP tool result, or the viewer's browser console). Trim it to the lines
around the failure; please don't paste megabytes.

```
<paste output here>
```

## Additional context

Screenshots, related issues, anything else you think might help.
