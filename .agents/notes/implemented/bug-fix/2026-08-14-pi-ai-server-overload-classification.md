# Agent Note: Preserve OpenAI Responses error metadata for retry classification

Status: implemented

English | [中文](2026-08-14-pi-ai-server-overload-classification.zh.md)

## Problem

OpenAI Responses errors reached the Harness as a pi-ai `errorMessage`. The original provider `error.code` and HTTP status were discarded, so retry classification depended on unstable display text. A temporary-capacity response could therefore become the non-retryable `PI_AI_ERROR` even when the downstream API identified it as a server failure.

## Decision

The local pnpm patch for `@earendil-works/pi-ai@0.82.1` extends `AssistantMessage` with `errorCode` and `errorStatus`. Its OpenAI Responses adapter copies an SDK error's code and HTTP status into terminal errors, and preserves response-stream error codes until that adapter catches them.

`mapStopReason` maps a recognized provider code first, then HTTP status, then flattened text for protocols that expose neither metadata field. Structured context-window codes also take priority over text- and usage-based overflow detection. `SERVER` and `RATE_LIMIT` remain eligible normal-policy retry codes; the route still owns the retry count and exponential-backoff settings, and the generic `PI_AI_ERROR` catch-all remains ineligible by default.

## Alternatives considered

**Match an overload phrase.** Rejected: wording is not a provider interface and cannot distinguish a capacity error from unrelated text. Flattened text remains only for pi-ai APIs that do not expose metadata.

**Make `PI_AI_ERROR` retryable.** Rejected: it also represents malformed provider responses and unexpected SDK failures, for which repeating the request has no established recovery value.

**Raise the normal-policy default budget to five.** Rejected: retry count is an operator choice on each provider route; the default remains bounded independently of this classification.

**Enable pi-ai SDK retries.** Rejected: hidden SDK attempts would bypass the agent loop's durable `llm/retry` records and multiply the configured request budget.

## Verification

The pi-ai converter test verifies provider-code precedence over conflicting status and display text, status-only server classification, and structured context-window classification. `dsh-llm-retry` coverage exercises bounded `SERVER` retries with exponential backoff.

## Consequences

- OpenAI Responses retries follow downstream metadata without widening recovery to unknown pi-ai failures.
- A provider route can select five bounded retries for `SERVER` or `RATE_LIMIT` while invalid `unsupported_value` requests remain terminal.
- A future pi-ai upgrade must reapply and review the version-pinned patch; other pi-ai APIs retain the legacy text fallback until they expose equivalent metadata.
