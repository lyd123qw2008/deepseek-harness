# Agent Note: Delegated children inherit the active model effort

Status: implemented

English | [中文](2026-08-14-delegated-children-inherit-active-model-effort.zh.md)

## Problem

The Web model selector records the parent's active provider, model, and reasoning effort in its `request/header`, but the in-process child drivers copied only the parent's static provider/model/maxTokens options. A child has no Web selection listener of its own, so an omitted effort reached adapters as their fallback. Codex Gateway therefore sent `none` for models that accept only named efforts such as `max`, and the child failed before it could do work.

## Decision

`AgentOptions` carries an optional explicit `reasoningEffort`. AgentLoop uses it for a fresh route, while a matching persisted header remains authoritative and adapter-materialized defaults remain unpinned. The Web API gateway and the headless runner seed all three default-selection fields into new Agents.

`resolveChildAgentOptions()` snapshots the parent request header's active provider/model route and its explicit effort before either in-process driver awaits child creation. It does not copy an adapter-default marker, and a request that overrides provider or model must explicitly name any non-default effort it needs. Both one-shot and continuable drivers use this resolver; continuable startup snapshots its result before provider preparation and persists the resolved route in the existing descriptor so cold resume has the route that established the child. A child that has completed a request restores its explicit effort from its own persisted request header.

## Alternatives considered

**Install the Web model selector in every child.** Rejected because it would couple all in-process delegation to the Web transport and give a child a session-selection owner it does not have.

**Copy only `parent.options`.** Rejected because that object does not reflect a session-local model selection and did not contain the selected effort.

**Copy adapter-materialized defaults as explicit effort.** Rejected because a child using another requested route could receive an unsupported value instead of resolving that route's own default.

## Testing

`packages/core/agent-loop/tests/loop.spec.ts` proves a fresh `AgentOptions.reasoningEffort` reaches the request. The one-shot and continuable in-process inheritance suites prove an active parent header with `max` becomes the child request. The keyless headless subagent snapshot records that same child header through a real Loader composition, and the restarted local DSH Web session exercises a live Codex Gateway child.

## Consequences

Delegated Codex children reuse an explicitly selected parent effort such as `max`, rather than silently falling back to `none`. A child that deliberately changes its provider or model gets that route's default unless the caller also selects an effort. No durable format changes: explicit child effort already belongs in the child's request header, while the continuable descriptor continues to own only its reconstructable route and composition.
