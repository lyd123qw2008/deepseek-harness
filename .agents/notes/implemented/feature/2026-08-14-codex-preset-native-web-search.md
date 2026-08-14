# Agent Note: Codex preset routes network research through native Codex search

Status: implemented

English | [中文](2026-08-14-codex-preset-native-web-search.zh.md)

## Problem

The Web profile's default `tool-web` exposes `web_search`, whose shipped provider routes network research through DeepSeek. A deployment with an authenticated official Codex CLI needs a preset that delegates research to Codex's native websearch without exposing two competing search tools.

## Decision

The shipped `codex` preset lives under `apps/cli/config/agent-presets/codex`. It keeps the standard coding capabilities, enables the `subagent_codex` tool, omits the model-facing `tool-web` row, and directs network research to Codex in its persona. The Web bundle explicitly depends on `@deepseek-ai/dsh-subagent-codex` and mounts its dormant `codex` provider on the host; the provider starts the native process only when the preset's tool is called. The base bundle remains free of product-provider dependencies and rows, as required by [Production dsh excludes product subagent providers](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md).

## Verification

The Web composition e2e lists the shipped preset, observes the host `codex` provider, mounts the preset through the real Loader, and asserts that its model-facing catalog contains `subagent_codex` but not `web_search`. The same test checks the preset persona's native-search instruction; the Codex provider's existing Loader and product tests cover startup without a process and the official app-server lifecycle.

## Alternatives considered

**Keep DSH's `web_search` in the new preset.** This would route the preset's network research through the DeepSeek provider instead of the requested native Codex capability and would leave the model with two competing research paths if Codex delegation were also exposed.

**Put the Codex provider in `dsh-base`.** This would add an optional product integration to every production install. The Web bundle is the explicit profile owner for this shipped preset, so the base dependency exclusion remains effective.

**Rename the delegated tool to `web_search`.** The shared delegation schema accepts a self-contained task rather than a search query and exposes provider lifecycle semantics. Keeping `subagent_codex` makes the native-product route explicit and prevents a generic search schema from claiming guarantees the Codex provider does not own.

## Consequences

The Web installation includes the Codex provider package and exposes the native-search preset in the GUI, while ordinary presets continue to use DSH's DeepSeek `web_search` route. Selecting `codex` requires the official `codex` command and its native authentication; loading the Web profile does not start that command. Network research pays for a separate Codex turn and returns through the existing subagent result contract.
