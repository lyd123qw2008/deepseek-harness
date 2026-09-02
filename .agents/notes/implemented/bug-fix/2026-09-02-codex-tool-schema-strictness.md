# Agent Note: Codex tool schemas use explicit non-strict sampling

Status: implemented

English | [中文](2026-09-02-codex-tool-schema-strictness.zh.md)

## Problem

The `openai-codex-responses` adapter in pi-ai passed `strict: null` to both shared tool-conversion calls. `convertResponsesTools()` treats `undefined` as the non-strict default, but serializes an explicit `null` when that value is supplied. A provider receiving a nullable strict flag may reject the tool definition or apply behavior different from the DSH schema. DSH tools such as `session_search` use optional properties and must not be silently converted to strict schemas.

## Decision

The local pnpm patch for `@earendil-works/pi-ai@0.84.2` passes `strict: false` in the deferred-tool message conversion and the immediate request-body conversion. The boolean makes the provider intent explicit and keeps the original JSON Schema. In pi-ai, only `strict === true` calls strict-schema conversion; that conversion makes optional properties nullable and adds them to `required`. `strict: null` therefore does not cause that local transformation, but it is still an invalid or ambiguous value to put on the provider request.

This change does not alter DSH tool schemas, normalize model-produced arguments, or remove validation for empty optional arrays. A model that emits `session_ids: []` still receives the existing validation error. The `openai-responses` adapter is a separate path whose converter already uses its non-strict default; this fix targets the Codex Responses adapter.

## Alternatives considered

**Enable strict sampling.** Rejected because it changes optional DSH properties into nullable required properties and requires schemas that are not the DSH tool contract.

**Filter or repair tool arguments after the model responds.** Rejected because it hides an invalid provider/model interaction and changes the meaning of tool input instead of fixing the request definition.

**Change every DSH tool schema to strict-compatible form.** Rejected because optional fields are part of the public tool contract and strictness is a provider conversion choice.

## Testing

The adapter regression captures the Codex request through pi-ai's `onPayload` hook without network access. It checks both immediate and deferred tool definitions, asserts `strict: false`, and compares the emitted parameters with a schema containing optional `session_ids`; the field remains absent from `required` and is not wrapped in a nullable union. The focused adapter suite passes on the Alpha.3 0.84.2 tree.

## Consequences

Direct Codex requests now carry a boolean non-strict flag while preserving optional DSH parameters. Constrained sampling remains available only when a tool explicitly requests it through pi-ai's constrained-sampling configuration. A future pi-ai upgrade must reapply and review the version-pinned patch hunk and refresh the corresponding `patch_hash` entry in `pnpm-lock.yaml`.
