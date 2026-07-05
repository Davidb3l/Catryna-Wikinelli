# Suite Contracts — pointer

The canonical spec lives in the **Sirius Forester** repo:
`Sirius Forester/SUITE_CONTRACTS.md` (GitHub: Davidb3l — Sirius Forester repo).
It defines how Ametrite, Hayvenhurst, Sirius Forester, and Catryna Wikinelli
discover, reference, and notify each other while staying fully standalone:

1. **Suite URIs** — `amt:issue/142`, `hayven:node/<id>`, `catryna:doc/<path>`,
   `sirius:receipt/<id>`. Catryna owns the `catryna:` scheme (`doc`,
   `observation`, `claim`). Foreign URIs are stored opaquely — e.g. a doc's
   `evidence` field citing `sirius:receipt/89`.
2. **Event spine** — append-only `.suite/events/<YYYY-MM-DD>.jsonl` per repo;
   envelope `{v, id, ts, source, type, refs, data}`; unknown types ignored.
3. **Doctor handshake** — `catryna doctor --json` → `{tool, version,
   schemaVersion, ok, capabilities, checks}`. Peer absence is a state, not an
   error: symbol-precise drift needs `hayven` present; git-diff drift needs
   nothing.
4. **CLI conventions** — `--json` = one JSON object on stdout, logs to
   stderr; exit codes 0/1/2/3; ISO-8601 UTC; write only your own store
   (`.docs/` + the spine).

## Catryna's v0 checklist (from the canonical spec §6)

- [ ] Emit `doc.created` / `doc.updated` / `doc.drifted` / `doc.verified` /
      `observation.added` from the MCP write tools.
- [ ] Consume `code.changed` → real-time drift-suspect marking (builds on
      the `catryna drift` baseline, PRODUCT_ROADMAP Phase 1).
- [ ] `evidence` / `refs` frontmatter fields accept suite URIs
      (FLEET_MOAT feature 1: trust-graded provenance).
- [ ] `catryna doctor --json` (requires the Phase 0 CLI).

Sequencing note: this lands with FLEET_MOAT Phase 4 (fleet integration) —
after the drift MVP passes its Virixia dogfood gate.

Do not edit this pointer's contract content — change the canonical file and
sync.
