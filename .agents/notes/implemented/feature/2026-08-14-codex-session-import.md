# Agent Note: Import standalone Codex CLI sessions

Status: implemented

English | [中文](2026-08-14-codex-session-import.zh.md)

## Problem

Standalone Codex CLI rollout files are JSONL documents in a product-specific event vocabulary. DSH persistence accepts its own versioned `SessionEvent` log and rejects foreign headers or event records, so copying a Codex file cannot create a DSH session. A useful import must preserve enough ordered conversation and tool history for a later DSH request while refusing records it cannot represent faithfully.

## Decision

The repository provides `scripts/import-codex-sessions.ts` and the `import:codex-sessions` root command. It reads rollout files recursively, requires a valid first `session_meta` record, and creates one DSH session with ID `codex-<source-id>`. The parser maps actual user and assistant text, recognized function/custom tool calls and outputs, turn boundaries, workspace, and creation time. Codex developer/system messages, injected Harness instructions, encrypted reasoning, Codex request headers, and unknown record types are not inserted into the DSH model transcript; unsupported records are counted and reported.

The importer constructs validated DSH events through `Session` and publishes them through `SessionStore` plus `JsonlSessionPersistence` with the configured Zstandard encoding. Existing IDs are skipped, source files are never written, each source file is isolated on failure, and `--dry-run` performs parsing and validation without creating the target persistence root. The backend remains responsible for publishing each new artifact.

The imported log does not carry a Codex request header. A later DSH prompt therefore resumes the persisted conversation under the DSH session's resolved preset, system prompt, tool schemas, and current model route. The result is a continuable DSH conversation, not an exact restart of the Codex runtime; historical assistant provenance identifies the source provider and model where available.

## Alternatives considered

Copying a Codex JSONL file into the DSH persistence root was rejected because DSH validates its own header, event envelope, and event vocabulary. Continuing through the existing Codex subagent provider was rejected because that provider deliberately creates ephemeral one-shot threads and returns only the final answer. Teaching every DSH persistence backend to accept Codex records was rejected because it would make an external product format part of the DSH storage contract; the importer keeps that translation at an explicit source-checkout command.

## Consequences

Web history loading can display imported sessions without starting an Agent. The first new prompt uses the existing API resolver's cold-resume path, so normal DSH ownership, workspace, preset, model, and approval policy rules apply. In the Web workspace view, a session with `cwd` but no persisted Workspace account appears in a browser-local cwd group labeled by its directory basename; this presentation does not mutate Host Workspace ownership. A dry run should precede a large import because unsupported Codex records can be numerous even when every source file is structurally valid.

The importer is a source-checkout command rather than a new installed launcher mode. It intentionally does not import images, encrypted reasoning, provider request state, or arbitrary Codex records. The parser and persistence tests cover successful mapping, unsupported records, malformed headers, idempotent re-import, persisted reload, and dry-run non-materialization.

## Verification

`pnpm exec vitest run scripts/import-codex-sessions.spec.ts --reporter=dot` covers the parser and persistence path. A real dry run over the configured Codex history validates 314 source files, identifies 301 importable sessions and 13 empty rollouts, and reports no malformed source file.
