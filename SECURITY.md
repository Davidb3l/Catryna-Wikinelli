# Security Policy

Catryna reads and writes documentation in your repository, runs git in it, and serves those docs to AI coding agents and to a local viewer. This page says how to report a problem and what Catryna does and doesn't defend against today.

## Supported versions

Catryna doesn't publish release artifacts yet. You install it from source or through the Claude Code plugin marketplace, both of which track `main`. Security fixes land on `main`; please update to the latest commit before reporting.

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
- **Catryna writes only to the project it runs in.** Both `.docs/` and the suite event log `.suite/` are resolved from the working directory. Computed-fact tokens (`{{count: …}}`, `{{loc: …}}`) are evaluated from a read-only allowlist, confined to the project root on resolved real paths so a symlink can't walk out, and never through a shell.
- **The docs viewer isn't access-controlled.** It's a development server with no authentication, and it **currently listens on all network interfaces (`0.0.0.0`)**, not only on localhost. Anyone who can reach port 1307 can list the projects it finds and read their docs and doc history. Until it binds to localhost by default, run it only on networks you trust.
- **Suite URIs are stored opaquely.** `evidence` and `refs` values in doc frontmatter are never resolved or fetched.

Out of scope:

- Malicious code or docs already in your own project directory (the same risk as any editor).
- Compromised AI providers or agents (you must trust the agent you give tool access to).
