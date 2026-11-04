# Agent Note: Restore DeepSeek Responses reasoning text on replay

Status: implemented

English | [中文](2026-10-08-deepseek-responses-reasoning-replay.zh.md)

## Problem

DeepSeek Responses thinking mode requires earlier `reasoning_text` items in each later request. A DeepSeek-compatible stream can omit `content` from its terminal reasoning item or return encrypted reasoning that the next request cannot verify, so a tool follow-up or later turn receives HTTP 400.

## Decision

A model-level `reasoningReplay` strategy controls `openai-responses` reasoning replay; omission defaults to `native` and preserves the captured provider signature. `durable-text` rebuilds a reasoning item as `{ type: 'reasoning', content: [{ type: 'reasoning_text', text }] }` using only the durable `reasoning` block, dropping response-only and gateway metadata; a block with no durable text has no replay signature. On response save, the adapter applies it only to Responses output; on history reconstruction, it applies to matching provider/model messages when the target model selects it, including history recorded under another protocol. This is a model-scoped exception to the [pi-ai replay projection](../architecture/2026-07-14-provider-routed-llm-adapters.md); `native` remains necessary for providers that require encrypted reasoning continuity. The source Web profile selects `durable-text` for DeepSeek `deepseek-flash`.

## Alternatives considered

**Switch the route to Chat Completions.** That changes the configured protocol and does not repair existing Responses history.

**Store streamed reasoning in a second replay field.** The durable reasoning block already records the model-visible text and reconstructs it across sessions.

**Strip only known unsupported fields.** A gateway can add passthrough fields beyond `summary` and `encrypted_content`; rebuilding from an allowlist prevents those fields from leaking into DeepSeek input.

**Infer the strategy from the provider name.** A named DeepSeek route may still use a gateway whose Responses endpoint requires native encrypted signatures; an explicit model setting makes that choice reviewable.

**Apply durable-text to every Responses provider.** Rebuilding reasoning as plaintext is not safe for providers that need encrypted signatures for continuity.

## Consequences

With `durable-text`, tool continuations and later turns receive the durable reasoning text and no response-only or gateway metadata, for current and persisted matching Responses messages. With `native` or an omitted strategy, signatures remain unchanged. The adapter cannot restore reasoning that was never durably recorded, so `durable-text` sends no reasoning item for an empty block.
