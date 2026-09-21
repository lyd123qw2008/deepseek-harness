# Agent Note: Terminal card survives an invalid escalation pair

Status: implemented

English | [中文](2026-09-21-terminal-card-invalid-escalation-pair.zh.md)

## Problem

A successful shell call can carry an optional escalation pair the Client rejects while the Host accepted it. When a command asks for the sandbox mode already in force, `isRedundantEscalation` lets the Host skip `validateEscalationArgs`, so the call runs and settles with a result. The Client has no redundancy concept: `validEscalationFields` requires a non-empty `justification` whenever `sandbox_permissions` is present, so the same arguments made `shellCall` return null, `terminalCardModel` return null, and the conversation row degrade to a non-clickable title and summary. The command and its output stayed in the session — the trajectory view and Details still read them — but the row lost the expand affordance that the same tool shows for a `pwsh` call, so whether a shell row could be opened depended on the model's optional argument field rather than on the tool or the platform.

## Decision

`terminalCardModel` keeps a shell card when the call itself proves it ran. A settled, non-error block whose single result text is present passes `allowInvalidEscalation` into `shellCall`, which then skips the escalation-pair check for that call only. Every other rule stays strict: a malformed pair on a running, errored, background, persistent, or spill-previewed call still takes the generic path, and `timeoutMs`, `workdir`, and `run_in_background` are validated exactly as before. The card renders `command`, `description`, `cwd`, output, and exit status and never displays escalation fields, so tolerating them cannot misreport what was requested.

The tolerance mirrors the rule the differential card already applies: a successful mutation with well-formed `meta.diffs` renders even when its optional escalation fields fail Client validation, which `diffCardModel` expresses as `allowAppliedMetadata`. This is a Client-side fix only. The Host needed no change because it had already accepted the call, and escalation legality is untouched: a genuine escalation request still needs a Host approval, which no Client decision can grant.

## Alternatives considered

**Drop the escalation check from `shellCall` entirely.** Rejected: a running call with a malformed pair would render a terminal card whose authority is still unknown, and the existing malformed-field spec table pins that fallback deliberately.

**Relax `validEscalationFields` itself.** Rejected: that helper is shared with the file-mutation tools and states the pair's own contract. The tolerance belongs to a card that holds proof of execution, not to the validator every caller shares.

**Derive redundancy in the Client.** Rejected: the Client does not receive the session sandbox policy, and hard-coding `danger-full-access` as "always redundant" would move a Host rule into a presentation model.

**Leave it to the model's argument hygiene.** Rejected: the degradation is silent, the row is where a reader opens the command in the conversation, and the same model emits the pair whenever the tool schema advertises escalation.

## Consequences

A settled successful shell call is expandable whenever its result text exists, even if the model re-requested the mode in force with a blank justification. The Client is deliberately more permissive than `validEscalationFields` in exactly one state, so the two rules must be read together and both are pinned by spec. Rows that show a card still only ever show facts the result carries; the tolerance cannot upgrade a failure into a success, because `isError`, persistent, and spill-previewed blocks keep the generic path.

## Verification

[Terminal card specs](../../../../packages/client/ui-tool/tests/terminal-card.client.spec.tsx) add the redundant full-access pair with a blank justification on a settled successful call (card retained, command preserved) and the same pair on an errored call and on a running call (generic path retained), while the pre-existing malformed-field table still rejects every running case. `pnpm vitest run packages/client/ui-tool` passes 313 tests across 17 files, and the client face typechecks with `pnpm exec tsc -b tsconfig.client.json`. A live Web session re-rendered previously degraded rows as expandable after the Client bundles were rebuilt, which also confirms the change needs no Host restart.

## Related

- [Nested terminal cards](2026-09-05-nested-terminal-cards.md) — owns terminal-card eligibility; its "malformed inputs retain generic fallback" clause now reads through this note's settled-success tolerance.
- [Client-derived tool presentation](../architecture/2026-08-23-client-derived-tool-presentation.md) — owns Client presentation ownership.
- [Local-exclusive DSH features and their upgrade treatment](../process/2026-09-16-local-exclusive-upgrade-treatment.md) — lists this tolerance among the local divergences an upgrade must keep or retire deliberately.
