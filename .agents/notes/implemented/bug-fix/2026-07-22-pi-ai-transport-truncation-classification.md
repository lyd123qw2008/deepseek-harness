# Agent Note: Classify pi-ai transport truncations from flattened message text

Status: implemented

English | [中文](2026-07-22-pi-ai-transport-truncation-classification.zh.md)

## Problem

Some pi-ai APIs still surface a mid-stream connection drop as the single notice `terminated`, and a truncated Anthropic response as `Anthropic stream ended before message_stop`. Both are transport truncations — the connection died before the provider's terminal SSE event — yet `dsh-llm-pi-ai` must classify these flattened messages without a provider code. The patched OpenAI Responses and Codex paths use structured metadata before this fallback.

For APIs that flatten the caught error before pushing the terminal `error` event, the detail loss is upstream and unrecoverable in the adapter: pi-ai reduces the error to `error.message`, discarding the original `Error` and its `cause` chain. undici carries the actionable `SocketError` on `cause` but hands the fetch wrapper a bare `terminated`; pi-ai keeps only that word. `onResponse` observes the HTTP response before body consumption and cannot recover a later mid-stream `cause`.

## Decision

- `classifyFlattenedPiAiError` recognizes two more transport wordings and maps both to `TRANSPORT`:
  - a mid-stream socket drop rendered as a bare `terminated` (undici) or `Premature close` (Node stream layer);
  - a stream truncated before its terminal event, which each pi-ai provider throws with its own wording (`Anthropic stream ended before message_stop`, `… before a terminal response event`, `… ended without a terminal event`, `Stream ended without finish_reason`), matched on `stream ended before/without`.
- `classifyFlattenedPiAiError` keeps the compatibility fallback for APIs that still flatten the original transport failure into text. The structured code and status decision for OpenAI Responses and Codex is recorded in [the structured metadata note](2026-08-14-pi-ai-server-overload-classification.md).
- `llm-pi-ai/README.md` records that APIs without preserved metadata classify their flattened transport messages from text and that structured OpenAI Responses/Codex metadata takes precedence.

Classification stays on message text for APIs that flatten the transport failure because that is the only signal pi-ai delivers. The patched OpenAI Responses and Codex paths classify their preserved metadata before this fallback.

## Alternatives considered

**Capture the `cause` via a pi-ai fetch/dispatcher/client hook.** Rejected: pi-ai exposes no hook that observes a mid-stream body failure before its error event is flattened. `onResponse` fires before the body stream is consumed, so it cannot observe a later drop. The Anthropic path accepts a `client` object, but constructing and injecting a provider SDK client per request to intercept transport errors reaches around the adapter boundary for one diagnostic string.

**Leave both as `PI_AI_ERROR` and widen `llm-retry`'s retryable set.** Rejected: `PI_AI_ERROR` is the catch-all for genuinely unclassified failures, including non-retryable ones (a malformed provider response, an unexpected SDK bug). Making the catch-all retryable would retry failures that will never succeed; the fix is to classify the recoverable case, not to blur the bucket.

**Wrap the flattened error in an `LlmError('TRANSPORT', { cause })` in the adapter, mirroring the DeepSeek adapter.** Rejected for APIs that flatten the provider error: the DeepSeek adapter wraps a *pre-response* `fetch` rejection whose `cause` is still intact, while the pi-ai terminal event has only a string and no `cause` to chain. Wrapping would add a layer without recovering anything; classification is the only value left to add.

## Consequences

- A mid-stream transport drop and a pre-terminal stream truncation now carry `TRANSPORT`, so a composed `llm-retry` policy retries them by default instead of failing the turn.
- The notice text is unchanged (`terminated` / `Anthropic stream ended before message_stop`): the cause detail is gone before the adapter sees it, so `errorChain` has nothing more to render. Only the routed `code` improved.
- Classification remains string-matching and provider-wording-dependent for APIs that flatten these errors: a future pi-ai release that rewords them would silently fall back to `PI_AI_ERROR` until the patterns are updated. Structured OpenAI Responses and Codex errors use their preserved code and status instead.
