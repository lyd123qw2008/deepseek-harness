# Agent Note: Compaction inherits a matching reasoning effort

Status: implemented

English | [中文](2026-08-14-compaction-inherits-reasoning-effort.zh.md)

## Problem

The direct compaction summarizer selected a provider and model from the routed conversation but omitted its reasoning effort. Adapters that serialize an absent level as a disabled-reasoning wire value could send a value the configured provider rejects even though the conversation request had a supported selected level.

## Decision

`summarizeWithLlm()` carries the latest logged reasoning effort when its provider and model match the resolved summarization target. With no matching logged route, it carries the `AgentOptions` effort when that target matches the agent target. An explicitly different configured summary provider/model receives no copied level and resolves its own adapter default.

## Alternatives considered

- **Rely on the adapter default** — rejected: adapters can serialize an absent setting differently from the selected conversation level, so the auxiliary request can be invalid while the conversation succeeds.
- **Copy the effort to every configured summary target** — rejected: a level valid for one model can be unsupported by another model or provider.
- **Add a separate compaction reasoning configuration** — rejected: the existing routed request already records the user's selected value; another independent setting would make the two requests diverge.

## Consequences

- Compaction uses the same selected reasoning level as the matching conversation route.
- A different configured summary target keeps its adapter-owned default behavior.
- The direct summarizer regression and the real-loop overflow recovery assert that a routed `max` level reaches the auxiliary request.
