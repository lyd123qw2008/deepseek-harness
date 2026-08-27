# Agent Note: Preserve OpenAI Responses and Codex error metadata for retry classification

Status: implemented

English | [中文](2026-08-14-pi-ai-server-overload-classification.zh.md)

## Problem

OpenAI Responses and Codex failures can reach the Harness with only a display message. Without the provider code and HTTP status, a transient capacity response can become the non-retryable `PI_AI_ERROR`, while a Codex `stream_transform_error` or HTTP/2 peer reset loses its transport meaning. Codex non-2xx handling also rewrites a structured error into a friendly message unless its body code and response status are preserved.

## Decision

The local pnpm patch for `@earendil-works/pi-ai@0.82.1` extends `AssistantMessage` with `errorCode` and `errorStatus`. Its patched OpenAI Responses and Codex adapters preserve provider codes and HTTP status through terminal errors, including Codex SSE errors and non-2xx body metadata. The patched OpenAI Responses catch also reports exposed non-2xx response headers through `onResponse`.

`mapStopReason` applies a recognized provider code first. Without a provider code, explicit quota, billing, or model-disabled wording remains terminal before HTTP status fallback; otherwise a valid HTTP status is used, followed by flattened text when structured metadata is absent. `stream_transform_error` and narrow HTTP/2 reset diagnostics map to `TRANSPORT`; transient structured overload and server codes map to `SERVER`, while the official Codex `server_is_overloaded` model-capacity code remains terminal `PI_AI_ERROR` ([Codex error definitions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/error.rs), [SSE mapping](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)). Unknown structured codes without status remain `PI_AI_ERROR`, and generic overload, internal-error, or try-again wording is not a retry signal. The adapter records Retry-After and request-id from non-2xx `ProviderResponse` headers, while successful 2xx response facts cannot decorate a later in-band stream error.

The `dsh-llm-retry` extension remains the sole visible retry owner. pi-ai keeps `maxRetries: 0`, and the adapter pins Codex routes to `transport: 'sse'` even when a profile configures another transport. This prevents a WebSocket `response.create` request from being replayed through auto fallback before the first event; one adapter stream therefore makes one model-generation request before the durable agent-level policy decides whether to retry.

## Alternatives considered

**Match an overload phrase.** Rejected: wording is not a provider interface and cannot distinguish a capacity error from unrelated text. Flattened text remains only for APIs that expose no structured metadata.

**Make `PI_AI_ERROR` retryable.** Rejected: it also represents malformed provider responses and unexpected SDK failures, for which repeating the request has no established recovery value.

**Enable pi-ai SDK retries.** Rejected: hidden SDK attempts bypass durable `llm/retry` records and multiply the configured request budget.

**Attach successful response headers to every later error.** Rejected: an in-band stream error after a successful HTTP response is not evidence that the HTTP response itself was transient; the adapter gates response facts to non-2xx statuses.

## Verification

Converter tests cover code precedence, status fallback, structured context-window and transient overload classification, terminal model-capacity classification, explicit quota/billing/model-disabled status guards, exact `stream_transform_error` and HTTP/2 reset wording, and negative generic-text cases. Direct patched OpenAI Responses tests cover type-only `response.failed` metadata; direct patched Codex tests cover SSE code and type-only errors, `response.failed` type fallback, and a 503 JSON body whose code, friendly message, and status survive. Adapter tests cover Codex transport pinning to one SSE generation request, non-2xx Retry-After formats/request-id propagation, valid response-status filtering and preservation of existing failure facts, the single-generation-request SDK retry guard, the 2xx stream-error gate, cancellation, and budget behavior. `sdk-options.spec.ts` keeps `maxRetries: 0` pinned, and `dsh-llm-retry` tests retain the bounded `SERVER`, `RATE_LIMIT`, `TIMEOUT`, and `TRANSPORT` policy.

## Consequences

- OpenAI Responses and Codex retry classification uses downstream metadata without widening recovery to unknown pi-ai failures.
- Non-2xx provider delay and request identifiers can reach the Harness retry policy when pi-ai exposes response headers.
- Transport failures whose upstream API flattens the original `cause` remain best-effort text classifications; the compatibility fallback and its rationale live in [the flattened transport note](2026-07-22-pi-ai-transport-truncation-classification.md). No adapter layer can recover a cause that pi-ai did not forward.
- A future pi-ai upgrade must reapply and review the version-pinned patch; its hash is recorded in `pnpm-lock.yaml`.
