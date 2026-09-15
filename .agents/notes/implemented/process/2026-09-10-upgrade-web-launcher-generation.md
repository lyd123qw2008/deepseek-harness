# Agent Note: Generate isolated Web launchers during upgrades

Status: implemented

English | [中文](2026-09-10-upgrade-web-launcher-generation.zh.md)

## Problem

Versioned Windows Web launcher files contain the target code home, data home, release label, and port, so copying a previous upgrade's files can leave a missing launcher or start the wrong installation.

## Decision

The repository provides [`upgrade-web-launchers`](../../../../scripts/upgrade-web-launchers.ts), which renders and verifies the complete five-file launcher set for an explicit target. `--write` creates the target-port files and `--check` rejects missing files, content drift, and launchers belonging to another port. The upgrade manifest preserves an existing `openssl-legacy.cnf` as optional target configuration; when the target data home contains that file, both operations include the temporary DeepSeek legacy-TLS environment setup in `start-web-<port>.cmd`. The command never removes files, so stale launchers remain visible for deliberate cleanup instead of being silently discarded.

The upgrade Skill runs generation after the target data home and code worktree are fixed, then requires the read-only check before startup and after cleanup. Launcher content is derived from one target description rather than copied from a prior data home.

## Alternatives considered

**Copy the previous data home's launchers.** Rejected because filenames can be copied without the complete target set, and their embedded release, code, data, or port values can remain stale.

**Add launcher filenames to the data migration manifest.** Rejected because the manifest tracks durable data coverage, while launcher correctness depends on rendered content and target launch parameters.

**Delete every launcher for another port during generation.** Rejected because the upgrade workflow must not remove files without an explicit operator decision; the check reports stale files and leaves cleanup attributable.

## Consequences

Each Windows Web upgrade has one reproducible generation command and one read-only launcher check. The check is intentionally strict about generated content and port ownership, while cleanup of stale launchers remains explicit. The generated launcher set is Windows-specific; other operating systems use their normal process-start path.
