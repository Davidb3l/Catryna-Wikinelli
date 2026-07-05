# Catryna Wikinelli — Product Roadmap & Market Research

> Written 2026-07-05. Tech-lead code review + PM market scan + forward roadmap.
> Context: Catryna is one tool in a growing agent-tooling suite alongside
> Ametrite (work tracking), Hayvenhurst (code graph), and Sirius Forester.
> Last commit before this review: 2026-01-04 (~6 months dormant).

---

## TLDR verdict

**Keep it — repositioned.** As built, Catryna is ~80% commoditized: reading and
searching markdown via MCP is table stakes (Claude can grep `.docs/` with zero
tooling), and "agent memory" is being absorbed by every IDE. But there is
genuine market whitespace that Catryna is one feature away from owning:

> **Doc-drift detection — the open-source, local-first Swimm for the agent era.**

Nobody free does it. The pain is measured (a 75-repo agent deployment study
attributed ~40% of task failures to stale context docs — "context rot"). And
Catryna's own flagship deployment proves the problem: **Virixia has 101 docs,
heavily used, and not one updated since 2026-02-17** while development continued
for five months. Catryna solved authoring and viewing; it never solved
**maintenance** — and maintenance is the whole game.

Neither Hayvenhurst nor Ametrite surpassed it. They are different layers, and
Hayvenhurst is the missing engine for Catryna's killer feature (see "Suite
positioning" below).

---

## Tech-lead code review (state as of 2026-07-05)

### What holds up

- **The core insight is right and aged well:** docs as git-versioned `.mdx`
  files, agents read for free, MCP only for structured writes, humans get a
  local viewer. Files-first / no database is the same instinct that made
  AGENTS.md win and made hosted auto-wikis (DeepWiki) get distrusted.
- Tiny, clean surface: 2 runtime deps (`@modelcontextprotocol/sdk`, `zod`),
  ~1,200 lines of server across `src/`. 10–11 well-scoped MCP tools.
- Real production usage: Virixia's 101-doc corpus was authored through it.
- The viewer's tldraw whiteboards + React Flow + Mermaid combo is genuinely
  novel in this category (no local-first competitor has it).

### Debt, in priority order

1. **Lossy round-trip (data-loss risk).** `parseMdx` in `src/storage.ts` is a
   simplified parser — paragraphs become one block per line, MDX components
   become opaque `raw` blocks. `updateDoc` re-serializes parsed blocks, so
   updating just a title can mangle a rich doc.
   **Fix:** make raw markdown the canonical storage format (the `markdown`
   block + CLAUDE.md already recommend it — finish the thought); treat blocks
   purely as a viewer render concern.
2. **Index/files dual source of truth.** A hand-edited or hand-added `.mdx`
   file is invisible to `get_doc`/search because `_index.json` never learns
   about it. **Fix:** `catryna reindex` rebuilds the index from files; index
   becomes a cache, never truth.
3. **Staleness is calendar-based** (`get_doc_coverage` flags docs untouched
   for 30 days). Run it on Virixia today and it flags all 101 docs — noise,
   not signal. Drift must be measured against *code changes*, not wall time.
4. **Coverage is honor-system.** `relatedFiles` is manually declared, never
   validated (renames/deletes silently rot the link), and matching is
   exact-path set membership only.
5. **Hygiene:** zero tests, no CI; server is cwd-bound to a single project;
   search is naive O(docs × filesize) substring scan per query; YAML
   frontmatter is built by string concatenation (a `"` in a title corrupts
   the file); `frontend/services/geminiService.ts` implies an API key in the
   client bundle — audit before any public push.

---

## Suite positioning: Catryna vs Hayvenhurst vs Ametrite

Each answers a different question — nothing got surpassed:

| Tool | Question it answers | Knowledge source |
|---|---|---|
| **Hayvenhurst** | "What calls X? What breaks if I change it?" | Derived from code — regenerable, never stale |
| **Catryna** | "How does auth work here, and why is it designed this way?" | Authored narrative — can't be derived, *can* go stale |
| **Ametrite** | "What are we working on? What did we decide?" | Work items + decisions over time |

The overlap worth acting on is synthesis, not competition: Catryna's drift
question — *"which docs does this code change invalidate?"* — is literally a
Hayvenhurst `impact` query. Doc anchors to symbols → code changes → walk the
graph → flag the docs. Swimm built a proprietary company on that mechanic; the
ingredients here are split across two repos in the same suite.

---

## Market scan (July 2026)

Flags: **(a)** agent-written repo docs · **(b)** staleness/drift detection vs
code · **(c)** human viewer

### Direct-ish competitors

- **Swimm** — closest incumbent: code-coupled docs in-repo, auto-flags/updates
  docs when referenced code changes (CI staleness check), IDE+web viewer. Now
  pivoting upmarket to an "agentic context layer" platform. Proprietary; free
  tier + ~$16/user/mo, enterprise sales. **(a)✓ (b)✓ core differentiator (c)✓**
  — https://swimm.io/
- **DeepWiki / Devin Wiki (Cognition)** — auto-generated hosted wikis for any
  GitHub repo, free for OSS. Hosted, not in-repo; accuracy/refresh-lag widely
  criticized. **(a)✓ hosted (b)✗ (c)✓**
- **Mintlify** — hosted docs "built for agents"; agent opens doc-update PRs.
  Metered $100–$1,000/mo. Public-facing docs, not internal architecture.
  **(a)~ (b)~ (c)✓ hosted** — https://www.mintlify.com/
- **Driver AI** — precomputed codebase understanding served via MCP;
  enterprise-only (SOC2, VPC). Not local-first. **(a)✓ (b)~ (c)✓**
- **Komment.ai** — CI doc/comment generation. **(a)✓ (b)~ (c) minimal**
- **CodeRabbit** — PR review + docstring generation only. **(a)~ (b)✗ (c)✗**

### Context/memory adjacent (not repo docs)

- **Context7 (Upstash)** — third-party library docs via MCP; not your own repo.
- **mem0 / Letta / Zep / Byterover / claude-mem** — agent memory layers; opaque
  DB memories, not human-readable git docs. All **(b)✗ (c)✗**.
- **Notion / Obsidian MCP servers** — generic KB; vault lives outside the repo,
  no code coupling, no coverage.
- **Small OSS docs-MCP servers** (arabold/docs-mcp-server, etc.) — search/read
  only, no coverage reports, no viewer, little traction.

### Conventions — what's winning

- **AGENTS.md won the instruction-file war** (Linux Foundation-stewarded, 60k+
  repos, 28+ tools; CLAUDE.md persists via `@AGENTS.md` import). But it's
  *instructions*, not architecture docs, and has zero drift tooling.
- **Spec-driven development** is the fastest-growing adjacent pattern (GitHub
  Spec Kit ~90k stars; AWS Kiro `.kiro/specs/` + steering). Specs are
  per-feature and ephemeral — not living architecture docs.
- **Cline Memory Bank** is the closest free pattern: agent-maintained markdown
  in-repo (systemPatterns.md, activeContext.md…). Pure prompt convention — no
  drift detection, no coverage, no viewer.
- **No standard exists** for an agent+human `.docs/` architecture folder *with
  tooling*. Appetite confirmed: 72.6% of studied Claude Code context files
  describe architecture (arxiv 2602.14690).

### Evidence for the pain (sources)

- "Context rot": stale CLAUDE.md/AGENTS.md as a named research problem
  (arxiv 2606.09090); ~40% of agent task failures attributed to context drift
  in a 75-repo deployment (arxiv 2602.20478).
- Trust in unreviewed AI docs is burned: DeepWiki HN threads — LLVM
  contributor: "incomplete to just plain incorrect"; LibreOffice: invented a
  build system; "a fractal of misinformation" (HN 43796308, HN 45002092).
  → argument for git-reviewed, in-repo docs.
- **llms.txt effectively failed** (97% of files got zero bot requests, May
  2026; Google dismissed it). Lesson: a convention nothing consumes dies.
  Catryna's consumption must be automatic (MCP + hooks), or it becomes
  llms.txt.
- "Documentation is easy to generate but hard to keep correct" is the
  recurring theme (arxiv 2606.04397). Generation is solved; **upkeep isn't.**

### Commoditized — do NOT build

Instruction files, agent memory (Claude Code auto-memory ships by default;
Cursor shipped Memories then *removed* them), docstring generation, one-shot
wiki generation, plain markdown-search MCP, hosted wikis, embeddings.

### Open whitespace — the defensible slice

1. **Drift detection between in-repo docs and code** — only Swimm
   (proprietary, enterprise-pivoting). No OSS local-first equivalent exists.
2. **Doc-coverage reports** at file/module level — nobody does this.
3. **Local-first human viewer** for agent-written docs — hosted exists, local
   doesn't; tldraw whiteboards are unique here.

Risks: Cognition/GitHub could ship in-repo wiki export; IDE auto-memory keeps
absorbing the low end; Cline Memory Bank shows users settle for a free prompt
convention unless coverage/drift delivers *visible* value.

---

## Roadmap

### Phase 0 — Make it sound (~1 week)

- [ ] Markdown-canonical storage; blocks become a viewer-only render concern
      (kills the lossy round-trip).
- [ ] `catryna reindex` — rebuild `_index.json` from files; index = cache.
- [ ] Proper multi-project support (per-project server or explicit `--root`),
      not cwd-bound.
- [ ] Tests for the storage round-trip + search; minimal CI.
- [ ] Escape/serialize frontmatter properly (use a YAML lib).
- [x] Claude Code plugin + skill + marketplace for one-command install
      (DONE 2026-07-05: `.claude-plugin/{marketplace,plugin}.json`,
      `skills/catryna/SKILL.md`, `commands/viewer.md`,
      `scripts/run-server.sh` self-healing launcher; install =
      `/plugin marketplace add Davidb3l/Catryna-Wikinelli` →
      `/plugin install catryna@catryna-wikinelli`).
- [ ] `bunx catryna` CLI packaging (npm publish) for non-Claude agents.
- [ ] Audit `frontend/services/geminiService.ts` for client-side API key.

### Phase 1 — The wedge: `catryna drift` (2–4 weeks — THIS IS THE PRODUCT)

- [ ] Upgrade `relatedFiles` → validated anchors: file + optional
      symbol/line-range; verified on write; rename/delete detection.
- [ ] `catryna drift` (CLI + MCP tool): diff the repo since each doc's last
      *verification commit* (new frontmatter field, not `updatedAt`), map
      changed files/symbols to anchored docs → "these 7 docs are contradicted
      by commits since March."
- [ ] **Close the loop agent-natively** (the thing Swimm can't do): hand the
      drift report to the agent and let it propose the doc update as a
      reviewable diff. Swimm flags for humans; Catryna repairs via agent.
- [ ] Ship consumption three ways: CLI (CI gate, exit non-zero on drift), MCP
      tool, and a Claude Code Stop-hook — a session that touched anchored
      files ends with "update the affected docs."
- [ ] Optional Hayvenhurst integration: symbol-level precision via the graph
      (`impact` of changed symbols → docs anchored to them) when the daemon is
      present; plain git-diff fallback when it isn't. Zero-dependency default.

### Phase 2 — Trust surface

- [ ] Freshness metadata in **every MCP read response**: "verified against
      commit abc123; 3 anchored files changed since." Agents get warned inline
      before trusting a stale doc (directly targets the context-rot failure
      mode).
- [ ] Verified-badge per doc in the viewer (green = verified at HEAD, amber =
      anchored code changed, red = anchors broken).
- [ ] Coverage report v2: module-level, trend over time, wired into the
      viewer dashboard.

### Phase 3 — Distribution

- [ ] Positioning: **"open-source, local-first Swimm for the agent era."**
      Complement AGENTS.md, never compete (AGENTS.md = instructions,
      `.docs/` = architecture).
- [ ] Demo asset: run `catryna drift` live on the Virixia corpus — 101 docs,
      5 months of unflagged drift, watch it identify exactly what the
      refactors invalidated.
- [ ] Viewer polish; suite story with Hayvenhurst/Ametrite/Sirius Forester.

---

## Immediate next step (decision gate)

Timebox a **two-week MVP**: Phase 0 + the git-diff version of `catryna drift`.
Dogfood against Virixia's stale 101-doc corpus — a perfect, measurable testbed.

**Kill signal (honest):** if the drift report on Virixia isn't compelling
enough that you immediately want to fix the flagged docs, stop investing and
keep Catryna in maintenance mode as an internal tool.
