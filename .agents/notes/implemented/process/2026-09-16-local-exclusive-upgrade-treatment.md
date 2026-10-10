# Agent Note: Local-exclusive DSH features and their upgrade treatment

Status: implemented

English | [中文](2026-09-16-local-exclusive-upgrade-treatment.zh.md)

## Problem

This checkout is a long-lived fork that tracks upstream releases while carrying its own behavioral changes. Most of those changes are not presentation tweaks: each replaces shipped behavior in a core package, and each is invisible to a released test suite because the tests that ship with a release describe the upstream design instead. One is a Client eligibility rule rather than a core behavior: taking the released model reverts it with no error at runtime, and only the local spec that pins the rule fails. A code upgrade reconciles the two sides file by file, and every file on the local side is a place where taking the released version silently reverts a deliberate decision — or, where the released version kept a different contract, leaves a failing gate behind.

The reconciliation has already gone wrong twice in one upgrade. The released contextual-diff block reached three files, and a first pass cleaned only one, leaving failing tests behind ([web diff card renders through a scroll viewport](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.md)). And because the local `scope` key on the MCP client is an undeclared schema key rather than a rejected one, taking the released client degrades the connection model with no error at all. A per-upgrade reading of the diff cannot catch either: the decision and its boundary have to be recorded once, in one place, so the next upgrade starts from the inventory instead of from `git diff`.

## Decision

This note is the inventory. It records the features that a release upgrade must keep on the local side, what each one changes relative to upstream, and the files it owns. The `dsh-upgrade-environment` skill consults it when it reviews personal commits against a target tag; the per-feature Agent Notes own the reasoning, and this note owns the list and the ownership boundaries.

The features are independent, and an upgrade must judge each on its own; a released change that touches one says nothing about the others.

| Feature | Upstream state | Local state | Owned files |
|---|---|---|---|
| Web diff card through a scroll viewport | Derives contextual hunks with `structuredPatch`, three context lines per side, folding with a hidden-line control and a bounded edit-distance search | Derives rows in the browser, one context line per unchanged segment, a scrolling body, 1-based line-number gutter and word-level highlights | 4 source files, 5 test files, 2 goldens |
| Agent Team capability isolated by preset | Disables the standard delegation rows and mounts the Team tool row in the profile layer, so a deployment is either standard delegation or Team | Retired in `dsh-v0.2.1-alpha.2` by owner decision; no local file remains | — |
| MCP client connection scope | `transport`, `serverName`, `command`, `url` and reconnect tuning; one child for the instance, with a static `cwd` | Adds `scope: 'global' \| 'session-project'`; the session-project pool opens one child per Session whose `cwd` is that Session's project | 4 files |
| Bash session cwd canonicalization | Uses the Session header's `cwd` verbatim as the base for a relative `workdir` | Canonicalizes it through `canonicalPath`, so a relative `workdir` resolves against the same root the policy stamps onto the call | 1 source file |
| Flat Expanded transcript | Retired in `dsh-v0.1.7-rc.1`, which ships `verbose`: `foldCompletedTurns: false` with `stepGrouping: 'none'`, and legacy `expanded` reads as `standard` | No local file remains; the migration moves a saved `expanded` preference to `verbose` | — |

### Retired by dsh-v0.1.7-rc.1

A release can also retire a local deviation by shipping the behavior. Each retirement below was verified against the released implementation, not inferred from the release notes; the local files and their tests were deleted or replaced in the same commit.

| Retired deviation | Released replacement |
|---|---|
| Flat Expanded transcript | `verbose` keeps `foldCompletedTurns: false` and `stepGrouping: 'none'`, and `ChatGroupSeat` derives `grouped` from `stepGrouping`, so no group header renders |
| Office kit pinned to `0.0.2-rc6` with a WASM-on-Windows README note | Kit `^0.1.0` declares `libreoffice-kit-win32-x64`/`-arm64`, the declared-native-engine rule the platform-engine note already documents |
| Hand-rolled authored-image-path resolver (`localPathMediaUrl` building `api/file?path=`) | Shared `fileMediaUrl`, which validates absolute POSIX and Windows paths and rejects UNC and control characters |
| Explorer `/select,` invocation tolerating exit code 1 in `path-opener` | `explorerTarget` plus `runExplorer`, which also escape commas and equals signs for Explorer's command line |

### Retired by dsh-v0.1.7-rc.2

| Retired deviation | Released replacement |
|---|---|
| Redundant-escalation tolerance mirrored from `tool-bash` into `tool-pwsh` | The shared `approveEscalation` returns the effective mode when the requested mode equals it, so both shells accept a repeated pair through one implementation |

### Retired by dsh-v0.2.1-alpha.1

| Retired deviation | Released replacement |
|---|---|
| Terminal card survives an invalid escalation pair | The released `shellCall` no longer validates the escalation pair at all — its comment records that the fields' validity depends on the Session's sandbox mode, which only the Host knows — so the local `allowInvalidEscalation` parameter and its two cases are gone. The released spec covers the same ground with a parameterized "escalation fields the Host accepts" case |
| `allowAppliedMetadata` on the diff card | The released `intendedDiff` dropped its `validEscalationFields` check for the same reason, so the local bypass that existed only to skip it is gone. The local parts of that file — the viewport height and the optional 1-based hunk-start validation — stay |

### Retired by dsh-v0.2.1-alpha.2

| Retired deviation | Released replacement |
|---|---|
| Windows watcher burst recovery in `skill-filesystem` | The native `raw` event path this branch coalesced no longer exists: the released watcher is chokidar with a `WatchHandle` of `{ mode, close() }`, so there is no `on('raw')` to attach to, and its config already reads `watchUsePolling` / `watchPollIntervalMs`. The burst window, its `handleNativeRawEvent`, and `watchNativeBurstWindowMs` were dropped with the two test files that pinned them |
| Agent Team capability isolated by preset | Retired by owner decision on `dsh-v0.2.1-alpha.2`, not because the release replaced it. The released plugin installs Team tools in every member scope, and the preset composition no longer gates them; the browser `enabledPresets` switch and the `agent-team-profile` patch went with it. The boundary the feature provided is deliberately given up: a Team-aware preset can no longer withhold Team tools from ordinary sessions. Its test asserted the gate through a bare `scope.ctx.plugin(...)` mount while the release mounts preset compositions through the Loader's `mountPreset`, so the gate had no verified path on `dsh-v0.2.1-alpha.2` either |

### Web diff card through a scroll viewport

Upstream derives the displayed rows from `structuredPatch` output with three context lines per side, folds a long body behind an expand control, and falls back to a coarse whole-fragment replacement past a bounded edit distance. This branch renders every row of a hunk into a body capped by `maxHeight`, keeps exactly one context line per unchanged segment, and adds a line-number gutter plus word-level highlights for hunks that carry `oldStart`/`newStart`.

The `oldStart`/`newStart` contract now lives in the released side as well: the released `computeHunkDiffs` documents 1-based hunk starts in its own return contract, so `edit.ts` and `write.ts` forward them into `presentationMeta` alongside the released `path: value.path` shape. Taking the released callers verbatim would have left the gutter without line numbers for `write` and `edit` results even though the hunks carried them.

The upgrade conflict is structural: the released contextual-diff block was written for the upstream design and asserts it, so it fails against this presentation on assertions this branch never implemented. The block arrived in three files, which is why the first cleanup left a failing gate.

Owned source: `packages/client/ui-primitives/src/DiffBlock.tsx`, `packages/client/ui-primitives/src/DiffBlock.module.css`, `packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`, and the host-side hunk slicing in `packages/fs/tool-fs/src/diff.ts` with its `edit`/`write` callers.

Owned tests and goldens: `packages/client/ui-primitives/tests/diff-block.client.spec.tsx`, `packages/client/ui-tool/tests/diff-card.client.spec.tsx`, `packages/client/ui-tool/tests/tool-row.client.spec.tsx`, `apps/web/tests/diff-context.e2e.ts`, and `snapshots/web/diff-context` with `snapshots/web/diff-bounded`.

Do not confuse this feature's files with the host-file-opening change (`fix(client): restore host file opening`), which owns `packages/client/ui-tool/src/client/contract/slots.ts`, `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`, `packages/client/ui-tool/src/client/tool/models/read-card-model.ts`, and the `read-row`/`read-family-row` toolview files. `ToolRow.tsx` and `diff-card-model.ts` sit near both; the released `tool-row.client.spec.tsx` case that exercises collapsed edit totals belongs to this feature, not to that one.

### Agent Team capability isolated by preset

Retired by owner decision in `dsh-v0.2.1-alpha.2`. The feature kept the standard delegation rows as one-shot, removed the Team tool row from the profile layer, gated `@deepseek-ai/dsh-experimental-tool-agent-team` on the plugin's own composition scope, and added a browser `enabledPresets` switch. All of it is gone: the four Team packages now match the release byte for byte, so a Team-aware preset can no longer withhold Team tools from ordinary sessions.

The decision was made after the gate stopped verifying. Its test asserted the boundary by mounting the plugin with a bare `scope.ctx.plugin(...)`, while `dsh-v0.2.1-alpha.2` mounts preset compositions through the Loader's `mountPreset`; under that mount the plugin never activated, so the gate had no demonstrated path on this release. The overlap that motivated the feature is unchanged by this retirement: `tool-subagent-control` and its `list-agents` companion still register `list_agents`, `send_message`, and `interrupt_agent`, the same three names the Team plugin registers, so a scoped registry still hands one agent two same-named tools whose answers come from different rosters.

Reinstating the boundary means expressing it through the released preset-composition mount rather than through `createScope` plus a direct plugin mount.

### MCP client connection scope

Upstream's stdio configuration carries `cwd` and `env` as static per-instance values and spawns one child with `cwd: config.cwd`. Nothing derives a working directory from the Session, so the official client cannot express "each Session's MCP child runs in that Session's project" — a shape a single static configuration cannot represent at all.

This branch adds `scope` to the stdio configuration. Under `session-project` it keeps one connection per Session, keyed by the Session id, and `openSession` overrides the configured `cwd` with the Session header's `cwd`. This matters for MCP servers whose state is keyed by the process working directory, which is exactly how `dsh-memory` and its Engram server resolve a project, so the Profile's Engram and IDEA rows both depend on it.

The reconciliation hazard is specific to this feature: `scope` is an undeclared key in the released schema, and undeclared keys are allowed rather than rejected, so taking the released client drops per-Session behavior without an error or a failing test. The only evidence would be a wrong project answer from Engram. Engram does accept `--project`/`ENGRAM_PROJECT`, but that is process-level and so cannot replace a per-Session binding.

Owned files: `packages/mcp/mcp-client/src/index.ts`, `packages/mcp/mcp-client/src/connection.ts`, `packages/mcp/mcp-client/src/tools.ts`, and `packages/mcp/mcp-client/tests/apply.spec.ts`.

### Terminal card survives an invalid escalation pair

Retired by `dsh-v0.2.1-alpha.1`. Upstream had validated the optional escalation pair on the Client regardless of what the Host accepted: a command re-requesting the mode already in force carries `sandbox_permissions` with an empty `justification`, `isRedundantEscalation` makes the Host skip `validateEscalationArgs` for exactly that pair, and `validEscalationFields` made `terminalCardModel` return null anyway, so the row degraded to a non-clickable title for a call that had already produced its output.

This branch kept the card for a settled, non-error block with a single result text by threading `allowInvalidEscalation` into `shellCall`, and `diffCardModel` carried the same tolerance as `allowAppliedMetadata`. The release removed the Client-side check from both models outright — `shellCall`'s comment now records that the fields' validity depends on the Session's sandbox mode, which only the Host knows — so both local bypasses lost their reason to exist and were dropped with the two cases that pinned them. The released spec keeps the coverage as a parameterized "escalation fields the Host accepts" case, and the [escalation-pair Agent Note](../../archived/bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.md) is archived with it.

## Upgrade checkpoints

For each feature, an upgrade decides between three outcomes and records which one it took. **Keep** takes the local file. **Adopt** takes the released file and retires the local decision, which requires deleting or rewriting the local tests that pin it and updating this inventory in the same change. **Merge** takes released behavior and re-applies the local intent on top, which is the expected outcome when upstream changes the same area without replacing the concept.

The signals that a feature needs re-examination rather than a default keep:

- **Web diff card**: upstream introduces a scrolling body, a line-number gutter, or inline highlights, or stops deriving rows from `structuredPatch` context. Upstream-only changes to context width or the edit-distance bound do not need one.
- **Agent Team**: retired in `dsh-v0.2.1-alpha.2`; the signal to reinstate it is a preset-composition mount that can express the capability boundary, plus the three overlapping tool names (`list_agents`, `send_message`, `interrupt_agent`) still being claimed by both `tool-subagent-control` and the Team plugin.
- **MCP client**: upstream adds a `scope` key or any other per-Session connection selection. A same-named key is not automatically the same concept: upstream's `scopeOf(ctx)` is plugin-registration scope, while `session-project` is a binding between a child process and a Session's project.
- **Terminal card**: retired in `dsh-v0.2.1-alpha.1`; the signal to re-open it is a release that validates the escalation pair on the Client again.
- **Retired deviations**: a release that changes the released replacement's contract puts the deviation back on the table — for `verbose`, that means any return of the whole-Turn fold or of a grouped historical header.

A released test file is not evidence that the local behavior is wrong. Where a released test pins a design this inventory declines, the local side owns the test file too.

## Alternatives considered

**Keep a running list outside the repository.** Rejected: the upgrade workflow reads the repository, and a list in a chat or a skill file drifts from the code the moment either side moves. An Agent Note is versioned with the files it names and is checked by the documentation gates.

**Let the per-feature Agent Notes carry the inventory alone.** Rejected: the entries are independent and their notes describe designs, not ownership boundaries. An upgrade needs one place that answers "which files does the released change conflict with", and that answer is not the same shape as any single design note.

**Record only the conflict-prone files.** Rejected: the MCP scope feature produces no conflict at all — it degrades silently — so a list keyed on conflict would omit the feature that most needs the warning.

**Adopt upstream and drop the local features.** Rejected: each feature exists because the upstream behavior was tested in use and rejected, and each replacement would cost a capability this deployment relies on (per-Session MCP project binding, standard delegation beside Team, and the diff presentation). Retiring any one of them is a deliberate decision, not an upgrade side effect.

## Consequences

An upgrade reads this note before reconciling, and its outcome per feature is recorded rather than rediscovered. The cost is that several upstream areas cannot be taken as-is, so a release that heavily rewrites one of them turns into a merge rather than a checkout; the checkpoints above keep that merge scoped by naming what has to be re-judged.

Every entry here is a reason to prefer contributing upstream over carrying a fork: the MCP connection scope and the per-preset Team boundary are general needs, not local preferences, and a released implementation would remove both the patch and this inventory. The diff card is a genuine local preference, and the escalation tolerance is a Client strictness fix that belongs upstream as well.

## Related

- [Web diff card renders through a scroll viewport](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.md) — owns the diff card decision, its measurements, and the alternatives it declined.
- [Web diff cards compare contextual content](../../archived/bug-fix/2026-09-14-web-diff-context.md) — the released contextual-diff decision this inventory declines.
- [Preserve user data during program upgrades](2026-09-08-upgrade-environment-preserve-and-merge.md) — owns how an upgrade is isolated, validated, and recorded.
- [Terminal card survives an invalid escalation pair](../../archived/bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.md) — the historical decision this inventory retired in `dsh-v0.2.1-alpha.1`.
