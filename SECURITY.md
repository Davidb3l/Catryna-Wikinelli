# Security Policy

Catryna reads and writes documentation in your repository, runs git in it, and serves those docs to AI coding agents and to a local viewer. This page says how to report a problem and what Catryna does and doesn't defend against today.

## Supported versions

Catryna doesn't publish release artifacts yet. You install it from source or through the Claude Code plugin marketplace, both of which come from `main`. Security fixes land on `main`. Before reporting, `git pull` a source checkout. For a plugin install, update the plugin, and reinstall it if its version hasn't changed.

## Reporting a vulnerability

Email **`dev@hayvenhurst.dev`** with details. **Don't open a public issue.** For sensitive reports, encrypt your message with the suite's PGP key (below).

We commit to:

- Acknowledging your report within **48 hours**.
- A coordinated disclosure window of **90 days** from acknowledgment.
- Crediting reporters in the changelog (unless you'd rather stay anonymous).

There is no bug bounty.

## PGP key

`dev@hayvenhurst.dev` is the maintainer address for the whole Sothis suite. Its key is published, with import and verification steps, in [Hayvenhurst's SECURITY.md](https://github.com/Davidb3l/Hayvenhurst-dev/blob/main/SECURITY.md#pgp-key).

- **User ID:** `David B (Hayvenhurst project signing key) <dev@hayvenhurst.dev>`
- **Fingerprint:** `08A5 F340 749A 15D5 F0B9  6F28 1A77 FC68 5EBE CDBB`

Check that the fingerprint matches before trusting the key.

## Verifying what you install

There are no signed release artifacts to verify yet. Clone from `https://github.com/Davidb3l/Catryna-Wikinelli`, or install the plugin from that repository's marketplace, and review the code you run.

## Threat model

What Catryna is designed around, and how far each defense goes today:

- **The MCP server has no network listener.** It talks to the agent over stdio only.
- **Doc content is data, not instructions.** Docs are written by agents and humans and read back by agents, so a doc can carry a prompt-injection attempt like any other file in your repo. Review doc changes in PRs the same way you review code.
- **Computed-fact tokens never run a shell.** Tokens (`{{count: …}}`, `{{loc: …}}`, `{{version: …}}`) are evaluated from a read-only allowlist, confined to the project root on resolved real paths so a symlink can't walk out.
- **The docs viewer isn't access-controlled.** It's a development server with no authentication, and it **currently listens on all network interfaces (`0.0.0.0`)**, not only on localhost. Anyone who can reach its port (1307 by default) can:
  - see the absolute paths of the projects it discovers (under your home directory, beside the Catryna checkout, or under `PROJECTS_ROOT`), and switch which one it serves;
  - read those projects' docs and doc history, including commit authors and titles;
  - read coverage and drift data: source file names and modification times, commit SHAs and dates, and changed file names.

  The viewer doesn't edit docs or source files, but a drift request runs `git status` (and Hayvenhurst, if installed) in the served project. Until the viewer binds to localhost by default, run it only on networks you trust.
- **Suite URIs are stored opaquely.** `evidence` and `refs` values in doc frontmatter are never resolved or fetched.

Out of scope:

- Malicious code or docs already in your own project directory (the same risk as any editor).
- Compromised AI providers or agents (you must trust the agent you give tool access to).
