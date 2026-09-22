# Agent Note: Bounded session-query fingerprints

Status: implemented

English | [中文](2026-09-02-bounded-session-query-fingerprints.zh.md)

## Problem

SQLite session reconciliation built one `JSON.stringify({ header, events })` value to fingerprint every observed session. A large persisted JSONL session could exceed the runtime string limit before its documents reached SQLite, producing `SESSION_QUERY_PERSISTENCE_FAILED` with `Invalid string length`; increasing the model-tool timeout did not remove that failure.

## Decision

`@deepseek-ai/dsh-session-query-sqlite` computes the observation fingerprint with a streaming SHA-256 hash. It hashes the detached header once, then updates the hash with a length-framed JSON serialization of each detached event. `observeSession()` keeps the existing detached-event and semantic-document ownership, but never constructs one JSON string for the complete event log. The same fingerprint algorithm remains in use for live and persisted observations, and the hash remains an in-memory change-detection value rather than a durable format field.

## Testing

The SQLite reconciliation suite rejects aggregate header-and-event serialization with a sentinel and still resolves a persisted search. The isolated Alpha.3 archive completed its first `DiffBlock` search across 197 sessions in 191466 ms after this change; subsequent `DiffBlock` and `invalid justification` searches completed in 2071 ms and 739 ms.

## Alternatives considered

**Only increase `searchTimeoutMs`.** Rejected because the runtime string construction fails before the search can return, regardless of the caller's wait budget.

**Skip sessions whose logs are too large.** Rejected because the derived index would silently omit searchable history and make the result set depend on an undocumented size threshold.

**Use persistence revisions as fingerprints for persisted sessions and retain aggregate serialization for live sessions.** Rejected because it would create two fingerprint rules and leave large live sessions exposed to the same runtime limit; one bounded algorithm keeps change detection uniform.

## Consequences

The first search still pays the cost of inspecting and indexing sessions absent from the derived database, and synchronous SQLite work remains non-preemptible. Once indexed, unchanged sessions are reused and later searches avoid the historical-log scan. Fingerprint computation no longer fails solely because the combined serialized event log exceeds the runtime string limit.

The derived index remains disposable and separate from JSONL session persistence. A changed event still produces a different fingerprint through the length-framed sequence, while event contents are not exposed through the fingerprint itself.

This fix is an implementation correction under the [SQLite FTS5 session search decision](../../archived/feature/2026-07-10-sqlite-session-query-provider.md); it does not change search authorization, indexing scope, tokenizer behavior, or cursor semantics.
