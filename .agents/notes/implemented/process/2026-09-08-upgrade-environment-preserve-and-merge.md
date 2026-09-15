# Agent Note: Preserve user data during program upgrades

Status: implemented

English | [中文](2026-09-08-upgrade-environment-preserve-and-merge.zh.md)

## Problem

Release-specific copy records do not define a reusable upgrade policy. Treating every program upgrade as a fresh installation can lose Sessions, attachments, Profile state, derived indexes, runtime tools, or user skills, while blindly copying SQLite files can discard newer target records and credentials.

## Decision

The repository now owns [`dsh-upgrade-environment`](../../../skills/dsh-upgrade-environment/SKILL.md), [`scripts/upgrade-environment.manifest.json`](../../../../scripts/upgrade-environment.manifest.json), and `verify-upgrade-environment`. The manifest distinguishes preserved source paths, SQLite state that requires an owning merge or rebuild procedure, and paths excluded for secret isolation or regeneration.

The Skill separates code upgrade from data migration. It starts a target worktree at the exact release tag, uses `git cherry` to distinguish patch-equivalent commits, applies reviewed personal commits oldest first with `git cherry-pick -x`, and validates the target code before touching user data.

The verifier requires explicit source and target homes. Copy-time mode checks selected byte-preserved files and source coverage; post-migration mode permits documented Session, configuration, and index rewrites while requiring every source file and optional target baseline file to remain represented. It never copies, deletes, prints secret values, or treats historical `excluded` arrays as policy.

The Skill keeps source and target worktrees, data homes, Profiles, credentials, and ports isolated. It requires pre-upgrade source and target-before backups, consistent SQLite snapshots, immutable released Session generations, independent attachment and Engram checks, target-only retention, cold startup, restart validation, and rollback from the target-before backup. It does not require a second full data copy after startup; post-start rollback copies and rehearsals are opt-in.

## Alternatives considered

**Reuse each release's migration JSON.** Rejected because those records describe completed transfers, include historical exclusions, and do not provide executable checks for future targets.

**Replace the target data home with a recursive source copy.** Rejected because target-only state and newer SQLite records can be deleted, and WAL/SHM files do not form a safe independent database snapshot.

**Hash the final target after smoke tests.** Rejected because startup legitimately creates Sessions, logs, credentials, indexes, and generated state after the copy-time checksum point.

## Consequences

Future upgrades share one manifest and one read-only structural check, while product-specific Session decoding, attachment integrity, SQLite queries, Engram diagnostics, Profile loading, and UI smoke tests remain explicit evidence. The process requires a pre-upgrade target-before backup and deliberate manifest updates when a new durable or secret-bearing path is introduced.
