# Agent Note: Local-exclusive DSH features and their upgrade treatment

Status: implemented

English | [中文](2026-09-16-local-exclusive-upgrade-treatment.zh.md)

## Problem

This checkout is a long-lived fork that tracks upstream releases while carrying its own behavioral changes. Three of those changes are not presentation tweaks: each replaces shipped behavior in a core package, and each is invisible to a released test suite because the tests that ship with a release describe the upstream design instead. A code upgrade reconciles the two sides file by file, and every file on the local side is a place where taking the released version silently reverts a deliberate decision — or, where the released version kept a different contract, leaves a failing gate behind.

The reconciliation has already gone wrong twice in one upgrade. The released contextual-diff block reached three files, and a first pass cleaned only one, leaving failing tests behind ([web diff card renders through a scroll viewport](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.md)). And because the local `scope` key on the MCP client is an undeclared schema key rather than a rejected one, taking the released client degrades the connection model with no error at all. A per-upgrade reading of the diff cannot catch either: the decision and its boundary have to be recorded once, in one place, so the next upgrade starts from the inventory instead of from `git diff`.

## Decision

This note is the inventory. It records the three features that a release upgrade must keep on the local side, what each one changes relative to upstream, and the files it owns. The `dsh-upgrade-environment` skill consults it when it reviews personal commits against a target tag; the per-feature Agent Notes own the reasoning, and this note owns the list and the ownership boundaries.

The features are independent, and an upgrade must judge each on its own; a released change that touches one says nothing about the others.

| Feature | Upstream state | Local state | Owned files |
|---|---|---|---|
| Web diff card through a scroll viewport | Derives contextual hunks with `structuredPatch`, three context lines per side, folding with a hidden-line control and a bounded edit-distance search | Derives rows in the browser, one context line per unchanged segment, a scrolling body, 1-based line-number gutter and word-level highlights | 4 source files, 5 test files, 2 goldens |
| Agent Team capability isolated by preset | Disables the standard delegation rows and mounts the Team tool row in the profile layer, so a deployment is either standard delegation or Team | Keeps the standard delegation rows as one-shot and installs the Team tool only inside the composition scope of the plugin, gated in the UI by preset id | 4 packages, 11 files |
| MCP client connection scope | `transport`, `serverName`, `command`, `url` and reconnect tuning; one child for the instance, with a static `cwd` | Adds `scope: 'global' \| 'session-project'`; the session-project pool opens one child per Session whose `cwd` is that Session's project | 4 files |

### Web diff card through a scroll viewport

Upstream derives the displayed rows from `structuredPatch` output with three context lines per side, folds a long body behind an expand control, and falls back to a coarse whole-fragment replacement past a bounded edit distance. This branch renders every row of a hunk into a body capped by `maxHeight`, keeps exactly one context line per unchanged segment, and adds a line-number gutter plus word-level highlights for hunks that carry `oldStart`/`newStart`.

The upgrade conflict is structural: the released contextual-diff block was written for the upstream design and asserts it, so it fails against this presentation on assertions this branch never implemented. The block arrived in three files, which is why the first cleanup left a failing gate.

Owned source: `packages/client/ui-primitives/src/DiffBlock.tsx`, `packages/client/ui-primitives/src/DiffBlock.module.css`, `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`, and the host-side hunk slicing in `packages/fs/tool-fs/src/diff.ts` with its `edit`/`write` callers.

Owned tests and goldens: `packages/client/ui-primitives/tests/diff-block.client.spec.tsx`, `packages/client/ui-tool/tests/diff-card.client.spec.tsx`, `packages/client/ui-tool/tests/tool-row.client.spec.tsx`, `apps/web/tests/diff-context.e2e.ts`, and `snapshots/web/diff-context` with `snapshots/web/diff-bounded`.

Do not confuse this feature's files with the host-file-opening change (`fix(client): restore host file opening`), which owns `packages/client/ui-tool/src/client/contract/slots.ts`, `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`, `packages/client/ui-tool/src/client/tool/models/read-card-model.ts`, and the `read-row`/`read-family-row` toolview files. `ToolRow.tsx` and `diff-card-model.ts` sit near both; the released `tool-row.client.spec.tsx` case that exercises collapsed edit totals belongs to this feature, not to that one.

### Agent Team capability isolated by preset

Upstream's Agent Teams profile layer disables `tool-subagent` and `tool-subagent-fork` outright so that "direct delegation and coordination" move to the Team tools, and it mounts the Team tool row in that layer. That makes the layer a deployment-wide choice: mounting it removes standard delegation everywhere, and the Team UI bundles globally with no preset gate, so ordinary sessions grow a Team affordance.

This branch keeps the standard delegation rows as one-shot (`backgroundMode: one-shot`) and removes the Team tool row from the profile layer. `@deepseek-ai/dsh-experimental-tool-agent-team` then installs its tools only for an agent whose scope chain contains the plugin's own composition scope, so a Team-aware preset becomes the capability boundary while the Team service stays host-owned. The browser side gains `enabledPresets` and renders nothing for other presets while keeping the slot mounted for stable registration and HMR.

The overlap is not hypothetical: `tool-subagent-control` and its `list-agents` companion register `list_agents`, `send_message`, and `interrupt_agent`, the same three names the Team plugin registers. Scoped registries reject a duplicate only inside one scope, so both layers can mount cleanly and hand one agent two same-named tools whose answers come from different rosters — silence, not an error. That is why the two layers must stay mirrored.

Owned files: `packages/experimental/agent-team-profile/cordis.patch.yml` and its profile test, `packages/experimental/tool-agent-team/src/index.ts` and its test, and `packages/experimental/client-ui-agent-team` (its `Config`, `TeamAction.tsx`, `mount.ts`, `index.ts`, and both client tests). The capability is only half the change: the presets that opt in live in the data home under `.agent-presets/team-local` and `.agent-presets/team-pragmatic-local`, which mount `tool-agent-team` themselves. A Profile that keeps its presets but loses this patch leaves those presets requesting a capability the layer no longer provides.

### MCP client connection scope

Upstream's stdio configuration carries `cwd` and `env` as static per-instance values and spawns one child with `cwd: config.cwd`. Nothing derives a working directory from the Session, so the official client cannot express "each Session's MCP child runs in that Session's project" — a shape a single static configuration cannot represent at all.

This branch adds `scope` to the stdio configuration. Under `session-project` it keeps one connection per Session, keyed by the Session id, and `openSession` overrides the configured `cwd` with the Session header's `cwd`. This matters for MCP servers whose state is keyed by the process working directory, which is exactly how `dsh-memory` and its Engram server resolve a project, so the Profile's Engram and IDEA rows both depend on it.

The reconciliation hazard is specific to this feature: `scope` is an undeclared key in the released schema, and undeclared keys are allowed rather than rejected, so taking the released client drops per-Session behavior without an error or a failing test. The only evidence would be a wrong project answer from Engram. Engram does accept `--project`/`ENGRAM_PROJECT`, but that is process-level and so cannot replace a per-Session binding.

Owned files: `packages/mcp/mcp-client/src/index.ts`, `packages/mcp/mcp-client/src/connection.ts`, `packages/mcp/mcp-client/src/tools.ts`, and `packages/mcp/mcp-client/tests/apply.spec.ts`.

## Upgrade checkpoints

For each feature, an upgrade decides between three outcomes and records which one it took. **Keep** takes the local file. **Adopt** takes the released file and retires the local decision, which requires deleting or rewriting the local tests that pin it and updating this inventory in the same change. **Merge** takes released behavior and re-applies the local intent on top, which is the expected outcome when upstream changes the same area without replacing the concept.

The signals that a feature needs re-examination rather than a default keep:

- **Web diff card**: upstream introduces a scrolling body, a line-number gutter, or inline highlights, or stops deriving rows from `structuredPatch` context. Upstream-only changes to context width or the edit-distance bound do not need one.
- **Agent Team**: upstream changes how the Team tool row is mounted, the `apply(ctx, config)` signature, the `mountAgentTeamUi` arity, or the tool names that Team and subagent-control both claim.
- **MCP client**: upstream adds a `scope` key or any other per-Session connection selection. A same-named key is not automatically the same concept: upstream's `scopeOf(ctx)` is plugin-registration scope, while `session-project` is a binding between a child process and a Session's project.

A released test file is not evidence that the local behavior is wrong. Where a released test pins a design this inventory declines, the local side owns the test file too.

## Alternatives considered

**Keep a running list outside the repository.** Rejected: the upgrade workflow reads the repository, and a list in a chat or a skill file drifts from the code the moment either side moves. An Agent Note is versioned with the files it names and is checked by the documentation gates.

**Let the per-feature Agent Notes carry the inventory alone.** Rejected: the entries are independent and their notes describe designs, not ownership boundaries. An upgrade needs one place that answers "which files does the released change conflict with", and that answer is not the same shape as any single design note.

**Record only the conflict-prone files.** Rejected: the MCP scope feature produces no conflict at all — it degrades silently — so a list keyed on conflict would omit the feature that most needs the warning.

**Adopt upstream and drop the local features.** Rejected: each feature exists because the upstream behavior was tested in use and rejected, and each replacement would cost a capability this deployment relies on (per-Session MCP project binding, standard delegation beside Team, and the diff presentation). Retiring any one of them is a deliberate decision, not an upgrade side effect.

## Consequences

An upgrade reads this note before reconciling, and its outcome per feature is recorded rather than rediscovered. The cost is that three upstream areas cannot be taken as-is, so a release that heavily rewrites one of them turns into a merge rather than a checkout; the checkpoints above keep that merge scoped by naming what has to be re-judged.

Every entry here is a reason to prefer contributing upstream over carrying a fork: the MCP connection scope and the per-preset Team boundary are general needs, not local preferences, and a released implementation would remove both the patch and this inventory. The diff card is the one genuine local preference of the three.

## Related

- [Web diff card renders through a scroll viewport](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.md) — owns the diff card decision, its measurements, and the alternatives it declined.
- [Web diff cards compare contextual content](../bug-fix/2026-09-14-web-diff-context.md) — the released contextual-diff decision this inventory declines.
- [Preserve user data during program upgrades](2026-09-08-upgrade-environment-preserve-and-merge.md) — owns how an upgrade is isolated, validated, and recorded.
