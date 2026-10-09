# Contributing to Catryna Wikinelli

Thank you for considering a contribution. Catryna is a small project with a single maintainer. PRs are reviewed personally and merged once they're right.

## Code of conduct

This project adopts the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report violations to `dev@hayvenhurst.dev`.

## Developer Certificate of Origin (DCO)

Every commit must be signed off:

```sh
git commit -s -m "your message"
```

The sign-off line (`Signed-off-by: Your Name <you@example.com>`) certifies that you wrote the change, or otherwise have the right to submit it under the project's MIT license. See [developercertificate.org](https://developercertificate.org) for the full text. There is no CLA.

## Development environment

Catryna is TypeScript on [Bun](https://bun.sh), with no other language stack. Use Bun for everything (`bun install`, `bun run`, `bun test`), not npm.

- **`src/`**: the MCP server (`src/index.ts`) and the `catryna` CLI (`src/cli.ts`). Run `bun install` from the repo root.
- **`frontend/`**: the Vite + React docs viewer. Run `bun install` from `frontend/`.

Typical dev loop:

```sh
# MCP server, restarting on change
bun run dev

# Docs viewer on http://localhost:1307 (in another terminal)
cd frontend && bun run dev

# The CLI, straight from source
bun run src/cli.ts doctor
```

## Tests and checks

Run the whole gate before opening a PR:

```sh
bunx tsc --noEmit -p .   # backend typecheck (src/)
bun run check            # frontend typecheck, bun test, catryna lint, catryna drift
```

`bun run typecheck` on its own only checks `frontend/`, so run the root `tsc` as well.

## Docs are part of the change

Catryna documents itself in `.docs/`, and `catryna drift` fails the gate when code changes under a doc that hasn't been re-checked. If your change touches code a doc describes:

1. Commit the code first. Drift reads git history, so it can't see uncommitted work.
2. Run `bun run src/cli.ts drift` and read each flagged doc against the new code.
3. Fix any prose that's now wrong, then re-baseline with `bun run src/cli.ts verify <path>`.

`verify` only records the commit. It doesn't read the doc, so judge each doc before you verify it.

## Pull request process

1. Open an issue first if your change is non-trivial. It saves you wasted work if the direction is wrong.
2. Branch from `main`. Keep branches focused: one logical change per PR.
3. Add tests for behavior changes. A bug fix should come with a test that fails without it.
4. Run the gate above, and add a line to `CHANGELOG.md` under "Unreleased".
5. Sign off every commit (`git commit -s`).
6. Open the PR with the template. Write the title as you'd want the commit message, since a squash merge may use it.

The maintainer aims to respond within a few days. If the PR isn't the right fit, you'll hear why and what would change that.

## Questions

Open an issue with the **Question** template.

## Reporting bugs

Use the matching issue template. **Drift got it wrong** exists because a wrong drift verdict needs different evidence from a typical bug: the doc's anchors, its baseline commit, and what `git diff` says.

## Security issues

Don't open a public issue. Email `dev@hayvenhurst.dev`. See [SECURITY.md](SECURITY.md).
