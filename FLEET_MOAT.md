# Catryna Wikinelli — Fleet Moat Strategy

> Written 2026-07-05. Companion to `PRODUCT_ROADMAP.md` (which stands: Phase 0
> hygiene → Phase 1 `catryna drift` remain the entry wedge). This document is
> the answer to a different question: **with autonomy emerging and Sirius
> Forester running fleets against Ametrite + Hayvenhurst, what can Catryna add
> that puts daylight between it and everyone else?**

---

## The thesis

Every competitor builds documentation for **humans assisted by agents** (Swimm,
Mintlify) or context for **a single agent in a single session** (memory layers,
Cline Memory Bank, AGENTS.md). Nobody is building the knowledge layer for
**autonomous fleets** — many agents, running unattended loops, across sessions,
where the human is the *auditor* of knowledge rather than its author.

That's the daylight. A fleet has knowledge problems a solo-agent world never
hits, and the suite is uniquely positioned to solve them because the loop is
already local and owned end-to-end:

| Suite role | Tool | What it owns |
|---|---|---|
| The board | Ametrite | tasks, decisions |
| The building | Hayvenhurst | code graph, claims, affected-tests |
| The foreman | Sirius Forester | dispatch, gates, receipts, fleet view |
| **The manual** | **Catryna** | **what the fleet knows — and how much to trust it** |

The open seam in the current loop: Sirius briefs agents with *code* context
(Hayvenhurst) but has no source of *narrative* context (why it's designed this
way, what was tried and failed). And when a job completes, receipts record
what/why at symbol level — but nothing updates the architecture narrative.
Knowledge decays exactly there. Catryna closes the loop.

---

## The six daylight features

Ordered by moat depth. Each lists why no competitor can follow easily.

### 1. Trust-graded knowledge (provenance per doc, not per repo)

Every doc (eventually every section) carries a machine-readable trust state:

```yaml
trust: asserted | verified | reviewed   # who vouches for this
verifiedAt: <commit sha>                # drift baseline (from PRODUCT_ROADMAP Phase 1)
verifiedBy: <agent/session or human>
evidence: [receipt:SF-142, bench/results.md]   # what backs the claim
```

- `asserted` — one agent wrote it, nobody checked (today's default, and the
  reason DeepWiki-style output got called "a fractal of misinformation").
- `verified` — an independent agent adversarially checked it against the code
  (the unbiased-review pattern already used across this suite's repos).
- `reviewed` — a human signed off (git review counts).

**Every MCP read returns the trust grade + freshness inline**, so an agent
knows whether it's reading law or rumor. Fleet policy becomes possible:
"autonomous loops may rely on `verified+`; `asserted` docs are leads, not
facts."

*Why the market can't follow:* hosted wiki generators are structurally
`asserted`-only; Swimm's trust model is "a human maintains it," which doesn't
scale to fleets. Trust grading only matters — and only works — when agents are
both the writers AND the readers.

### 2. Executable claims (`catryna verify`) — drift detection beyond Swimm

Docs stop being only prose; key sentences become **checkable claims**:

```yaml
claims:
  - text: "The app never calls vLLM directly — only the appliance's /answer and /embed"
    check: { type: grep-absent, pattern: "vllm", paths: ["app/src/**"] }
  - text: "checkProjectWriteAccess is called by every project mutation"
    check: { type: hayven-refs, symbol: "checkProjectWriteAccess", min: 1 }
  - text: "all chunks map to exactly one section"
    check: { type: test, ref: "app/src/ingest/chunk.test.ts" }
```

`catryna verify` (CLI + CI + MCP) runs the checks. This upgrades drift
detection from Swimm's *"code near this doc changed"* (correlation) to
**"the sentence this doc asserts is now false"** (contradiction). A failed
claim downgrades the doc's trust grade automatically and emits a drift item.

Check types at launch: `grep-absent`/`grep-present`, `file-exists`,
`test` (a named test must pass), `hayven-refs`/`hayven-impact` (graph
assertions, optional dependency). Extensible later.

*Why the market can't follow:* this requires the doc system to reach into code
execution and a code graph. Swimm tracks line spans; nobody validates semantic
claims. It's also the feature agents are uniquely good at authoring — an agent
that just verified a fact can cheaply emit the check that keeps it verified.

### 3. The negative-knowledge registry (do-not-re-attempt store)

A first-class doc type for **refuted approaches and measured dead ends**:

```yaml
type: negative
scope: [daemon/src/conflict/**]        # anchor by path/symbol
verdict: "Do NOT prompt-tune the 1-4B local oracle — structural, measured"
evidence: [docs/ORACLE_WARMTH_DECISION.md#s10, receipt:SF-089]
expires: never | <condition>           # e.g. "if model class changes"
```

This suite's own repos prove the need — Hayvenhurst's CLAUDE.md carries a
hand-maintained "standing engineering constraints / do-not-re-litigate"
section because autonomous sessions kept needing it. Catryna makes that a
queryable, anchored, fleet-wide primitive: **when Sirius briefs an agent on a
task whose scope overlaps a negative entry, the verdict is injected into the
briefing automatically.**

The economics write the pitch: an autonomous looper without negative knowledge
re-burns tokens re-exploring refuted paths *every loop, forever*. This is the
single highest-ROI knowledge type for fleets, and **no product in the market
has it as a primitive** — not Swimm, not any memory layer (memories are
per-agent and opaque; this is shared, human-auditable, evidence-linked).

### 4. Briefing packs (`catryna brief`) — the Sirius integration

```
catryna brief --task AMT-142 --symbols "checkProjectWriteAccess,ProjectService" --budget 4000
```

Returns the minimal narrative context pack for a job: relevant doc sections
(by anchor overlap with the task's claimed symbols), each stamped with trust
grade + freshness, plus any overlapping negative-knowledge verdicts and open
drift warnings — fitted to a token budget.

Sirius attaches this to its briefing the same way it attaches Hayvenhurst's
code context: **Hayvenhurst briefs the agent on the code, Catryna briefs it on
the why.** Hayvenhurst's own pivot finding (graph-precise slices cut re-sent
context 78–86%) says slices beat whole files; the same is true of narrative.

*Why the market can't follow:* a briefing compiler is only valuable to whoever
runs the dispatcher. Standalone docs tools have no dispatcher to feed.

### 5. The librarian loop — multi-writer discipline + self-healing docs

Fleet agents concurrently writing canonical docs is a collision and quality
disaster (the same reason Hayvenhurst has a claim board for code). Split the
write path:

- **Observations (append-only, cheap):** any agent can
  `add_observation(anchor, note, evidence)` — no contention, no curation
  burden mid-task. Sirius receipts can auto-emit observations for touched
  symbols.
- **Canonical docs (curated):** a recurring **librarian job** — dispatched by
  Sirius like any other task — distills observations into the canonical docs,
  runs `catryna verify`, repairs drift flagged since last run, upgrades or
  downgrades trust grades, and proposes prunes. Human reviews the diff.

This makes the knowledge base **self-healing on the same rails as the code
work**: drift and observations become Ametrite issues; Sirius dispatches them;
gates apply; receipts link the repair. No competitor can ship this because it
requires owning the foreman.

### 6. Consumption telemetry — docs that earn their keep

Log every MCP read (doc, agent, task). Now the corpus has economics:

- **Never-read docs** are context-rot fuel → merge/prune candidates for the
  librarian.
- **Read-before-failure docs** (task failed after consuming doc X) are
  suspects → flag for verification.
- **High-traffic `asserted` docs** are the risk hotspot → prioritize
  verification there, not calendar-based.

Verification effort gets allocated by consumption × trust-gap, which is the
only allocation that scales to hundreds of docs and an unattended fleet.
Nobody measures agent doc consumption today; hosted tools can't see it and
solo-agent tools have no fleet to aggregate.

---

## What this adds up to

> **Catryna 2.0: the trust layer for what autonomous fleets know.**
> Graded provenance, claims that verify themselves, a registry of dead ends,
> briefings on demand, and a librarian loop that keeps it all true — local,
> git-versioned, human-auditable.

Swimm keeps docs *fresh for humans*. Catryna keeps knowledge *true for fleets*
— and provably so. The moat is compound: features 3–6 are only buildable by
someone who owns the foreman, the graph, and the board. That's the suite, and
nobody else has one that's local-first.

## Integration contracts to agree early (verbatim, per suite convention)

- `catryna drift --json` / `catryna verify --json` → one JSON object, exit
  `0/1/2/3` (Hayvenhurst exit-code convention) so Sirius can gate on it.
- `catryna brief --task <id> --symbols <list> --budget <tokens> --json` →
  `{sections:[{path, anchor, trust, verifiedAt, text}], negatives:[...], driftWarnings:[...]}`.
- Sirius receipt hook: on job completion, `catryna observe` with the receipt's
  symbol list (drift flag + observation in one call).
- Frontmatter fields owned by Catryna: `trust`, `verifiedAt`, `verifiedBy`,
  `evidence`, `claims`, `type: negative`, `scope`, `expires`.

## Sequencing (amends PRODUCT_ROADMAP, doesn't replace it)

1. **Phases 0–1 unchanged** — hygiene + git-diff `catryna drift`, dogfood on
   Virixia. Everything above builds on trustworthy storage + drift baselines.
2. **Phase 2 absorbs feature 1** — trust grades ARE the "trust surface"
   (frontmatter + graded MCP reads + viewer badges).
3. **Phase 3: claims + negative knowledge** (features 2–3) — highest moat per
   week of work; both are frontmatter + a small check-runner, no new services.
4. **Phase 4: fleet integration** (features 4–5) — build alongside Sirius
   v1 implementation so the contracts land in both repos together.
5. **Phase 5: telemetry** (feature 6) — needs real fleet traffic to matter;
   last.

## Honest risks

- **Sequencing risk:** all six features are worthless if Phase 1 drift never
  ships. The kill-signal gate in PRODUCT_ROADMAP still applies. Don't start
  FLEET_MOAT work before the Virixia drift dogfood passes.
- **Spec-surface risk:** claims/trust/negative types are schema — resist the
  urge to over-design; ship 4 check types and 3 trust grades, extend on
  evidence.
- **Suite coupling risk:** every feature must degrade gracefully to
  standalone-Catryna (git-diff drift, grep/test checks, manual briefs) or the
  standalone wedge dies and with it the funnel into the suite.
- **The market can move:** Cognition/GitHub shipping in-repo wiki export
  commoditizes authoring further — which *strengthens* the trust-layer
  positioning (more unverified docs = more need for grading), but only if
  Catryna is already known for verification by then. Speed matters on
  Phases 1–3.
