# Agent Note: Preserve explicitly ignorable session events during Alpha migration

Status: implemented

English | [中文](2026-08-30-ignorable-session-events.zh.md)

## Problem

The Alpha reader rejects every event type outside its generated first-party set. The migrated JSONL sessions contain 42 `web/codex-search-llm-request` records written by the mounted Codex search provider; each record is a secret-free request audit and carries the explicit `ignorable: true` marker. Without the marker-aware reader, the sessions remain intact but their history cannot be opened.

## Decision

`SessionEvent` accepts an optional `ignorable: true` envelope field, and seed validation accepts only that exact boolean value. `PersistenceCoordinator` continues to reject every unknown event without the marker and accepts a marked unknown event without interpreting its payload. The generated `KNOWN_SESSION_EVENT_TYPES` set remains the authority for required first-party events; the marker is an explicit per-record exception for informational extension records, not a registration mechanism or a default for unknown types.

The Alpha JSONL migration preserves the existing marked `web/codex-search-llm-request` records and does not delete, rename, or rewrite them. The Codex request audit contains the resolved endpoint and secret-free request body, and it does not contribute to the conversation surface or request-header reconstruction. A future producer must establish the same non-semantic property before writing this marker.

## Alternatives considered

**Delete the Codex request records during migration.** Rejected because deletion would alter the source history and remove useful request-audit evidence; the existing marker already states that the records can be skipped by a reader that lacks the provider type.

**Accept every unknown event type.** Rejected because an unrecognized record may affect model input, recovery, policy state, or a plugin projection. The default remains fail-closed.

**Add the Codex provider event to the first-party generated vocabulary.** Rejected because the provider is mounted from an external package, and making its type first-party would couple the core catalog to one deployment-specific implementation. The explicit marker keeps the repository-owned event set composition-independent.

**Use a session-format bump or renumber the migrated log.** Rejected because the JSONL records already use the v0 envelope and valid monotonic sequence numbers. Reading the marked records requires no structural rewrite.

## Consequences

Marked unknown events remain in the loaded event list, so raw-log fidelity and sequence references are preserved even though core projections ignore them. A malformed marker, a marker with any value other than `true`, or an unknown required event still refuses seed or persistence loading. The optional envelope field is a compatibility reader path for the JSONL migration; it does not make external event registration available to other persistence backends.

Core seed validation, persistence coordinator tests, the generated persistence catalog, and the migrated-session scan cover marker acceptance and fail-closed rejection. The scan verified all 42 migrated Codex request records carry `ignorable: true` and no torn Zstandard frame exists in the 177 migrated session logs.
