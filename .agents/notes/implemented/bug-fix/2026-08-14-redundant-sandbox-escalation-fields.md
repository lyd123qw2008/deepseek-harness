# Agent Note: Covered sandbox escalation fields preserve the standing policy

Status: implemented

English | [中文](2026-08-14-redundant-sandbox-escalation-fields.zh.md)

## Problem

OpenAI-compatible coding clients can retain `sandbox_permissions` on a tool call after the session already runs at that target mode. Before this fix, `dsh-tool-bash`, `dsh-tool-pwsh`, and `dsh-tool-fs` validated the accompanying `justification` before resolving the standing policy, so a blank or absent inherited value failed with `invalid justification`. A non-empty inherited value reached `approveEscalation` and failed with the unrelated non-strict-widening error. In a no-approval composition, neither form could execute despite asking for no additional authority.

## Decision

`dsh-sandbox` exports `isRedundantEscalation`, which recognizes only a known target already covered by a known effective mode. The predicate never classifies an unknown target or effective mode as redundant.

The bash, PowerShell, and filesystem tool consumers resolve their standing policy before validating the escalation pair. A redundant known target bypasses pairing validation and `approveEscalation`, then executes under the unchanged standing policy. No approval request, grant, or policy mode change is created.

Every authority-changing request retains the existing path from [the sandbox decision](../feature/2026-07-06-sandbox.md): paired argument validation, strict widening against the effective mode, and approval before execution. The filesystem path stays identical to the shell paths under [the cross-family decision](../feature/2026-07-14-cross-family-fs-sandbox.md).

## Alternatives considered

**Reject every non-widening request.** Rejected because inherited standard-tool fields are no-op metadata under an already-covering policy, yet they prevent an otherwise allowed operation from running.

**Weaken `approveEscalation`.** Rejected because the shared approver remains the fail-closed authority-changing boundary. Normalization belongs at the consumer, where the completed standing policy is available and no approval side effect has started.

**Ignore every malformed escalation pair.** Rejected because a request that might change authority still needs a non-empty human-facing reason. Only a known, already-covered target bypasses that requirement.

## Consequences

Sessions already at `workspace-write` or `danger-full-access` accept an inherited matching or narrower known target without an approval prompt, including a blank or absent inherited `justification`. Unknown modes, missing-policy compositions, and any target that would widen authority retain their existing validation and fail-closed behavior.

Focused unit coverage pins the shared classification, bash, PowerShell, and filesystem behavior, including the blank-reason and absent-reason cases. The existing direct `approveEscalation` tests continue to pin strict rejection for a non-widening call that reaches the authority-changing boundary.
