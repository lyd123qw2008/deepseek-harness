# Agent Note: Preserve provider failure facts for model retry classification

Status: implemented

English | [中文](2026-08-14-pi-ai-server-overload-classification.zh.md)

## Problem

Provider failures can reach the Harness with a generic display message. Without a stable retry code, a transient capacity response or a transport reset becomes non-retryable `PI_AI_ERROR`, while retry delays and request identifiers from the provider response are lost.

## Decision

`dsh-llm-pi-ai` classifies provider failure codes from the preserved pi-ai message metadata when available, pi-ai 0.84 diagnostics, and a narrow token fallback for APIs that flatten metadata into `errorMessage`. Transient server, rate-limit, timeout, and transport codes map to the Harness retry vocabulary. Quota, billing, model-disabled, model-unavailable, and the provider-specific `server_is_overloaded` capacity code remain terminal. HTTP/2 stream-reset and `stream_transform_error` wording maps to `TRANSPORT`; generic overload or internal-error prose does not become a retry signal by itself.

The adapter captures every HTTP response through the request `fetch` option and also accepts pi-ai's `onResponse` callback. It retains only non-2xx status, `Retry-After`/`Retry-After-Ms`, and common request-id headers on an error finish. A response with status 2xx cannot decorate a later in-band stream failure. When a generic error has no stronger terminal or retry classification, its non-2xx status supplies the retry code.

The adapter keeps `maxRetries: 0`, and pins Codex response routes to SSE. `dsh-llm-retry` remains the only owner of visible model retries, durable `llm/retry` events, backoff, and retry budgets. One adapter stream therefore represents one model-generation attempt before the Harness retry policy decides whether to start another.

## Alternatives considered

**Make every `PI_AI_ERROR` retryable.** Rejected because the code also represents malformed requests, unavailable models, and unexpected SDK failures for which repeating the request has no established recovery value.

**Retry inside pi-ai.** Rejected because hidden SDK attempts bypass durable `llm/retry` records and multiply the configured request budget.

**Match arbitrary overload or internal-error prose.** Rejected because display wording is not a provider interface and can describe a terminal model or account condition. Structured codes, response status, and narrow transport markers remain the accepted signals.

**Treat a successful response as evidence for a later stream error.** Rejected because an in-band error after a 2xx response does not prove that the HTTP response itself was transient.

## Consequences

Transient provider failures can enter the configured `SERVER`, `RATE_LIMIT`, `TIMEOUT`, or `TRANSPORT` retry policies with response timing and request identity when the provider exposes them. Terminal account and model failures remain visible without retrying. Transport causes that pi-ai discards remain best-effort text classifications; the adapter cannot recover a cause that no longer exists in the event.

Focused adapter and converter tests cover one-request SDK behavior, response-fact propagation, provider-code precedence, terminal capacity/account cases, diagnostics, and HTTP/2 transport wording. The provider-routed retry tests continue to cover durable backoff and budget behavior.
