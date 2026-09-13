---
description: "Published experimental Agent Teams Host profile layer over dsh-base; Team-aware presets opt into the model-facing coordination tools."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-agent-team-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-agent-team-profile` is a published experimental profile layer that provides the [Agent Teams](../agent-team/README.md) Host service over `@deepseek-ai/dsh-base`. Its patch inserts the durable Team domain, disables the overlapping global continuable-child controls, and keeps the ordinary fresh and fork delegation tools as one-shot operations. The model-facing Team policy and tools are mounted by an explicit Team-aware preset, so ordinary presets do not receive Team capabilities. The dsh installation ships it as an optional bundle that no shipped profile enables; switch it on from the Web sidebar's Plugins page, or add it explicitly to an initialized profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Add the package to an initialized profile, then run a task that asks the Lead to delegate work:

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
dsh --profile headless "Use Agent Teams to split this task between two teammates, wait, and summarize."
```

The profile must already contain `@deepseek-ai/dsh-base`, whose Subagent services and provider rows this layer consumes. Removing the package with `dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-agent-team-profile` removes the bundle from the profile's ordered layer list.

### What you get

The layer adds the durable Agent Teams domain, disables the global continuable-child control rows whose tool names overlap with Team controls, and leaves `subagent` and `subagent_fork` available as one-shot delegation tools. A Team-aware preset that needs the model-facing Team policy and nine Team tools must explicitly mount `@deepseek-ai/dsh-experimental-tool-agent-team`; ordinary presets remain free of Team model inputs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package's runtime content is [`cordis.patch.yml`](cordis.patch.yml). Applied after `dsh-base`, the patch disables `tool-subagent-control` and `tool-subagent-list-agents`; sets the fresh and fork Subagent rows to `one-shot`; and inserts the Team service with explicit limits. The model-facing tool row is mounted by a Team-aware preset rather than globally by the Host profile.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Ordered patch over `dsh-base` |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |
| — | No runtime invariant companion is published; the package carries only a static profile patch. The Team domain and tool packages own the mutable relationships it activates. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md) — incubation status and publication policy.
- [Agent Teams service](../agent-team/README.md) — durable roster, messaging, and task-board behavior.
- [Agent Teams tools](../tool-agent-team/README.md) — the Team-scoped model tool surface.
- [Base bundle](../../bundle/base/README.md) — the profile layer this patch extends.

-----

<a id="model-experience"></a>
## Model Experience

### Team policy and tools

#### What the model sees

Only a Team-aware preset that explicitly mounts [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.md) receives the Team policy and Team-scoped `list_agents`, `send_message`, `interrupt_agent`, and related tools. They replace the disabled global continuable-child controls inside that preset's Agent scope. Ordinary presets receive no Team model inputs. `subagent` and `subagent_fork` remain available as one-shot delegation tools, whose children do not receive the continuable-child `report` tool.

#### Token effect

The Host profile adds no Team policy or tool schemas to ordinary sessions; Team-aware presets pay the fixed prompt and schema cost described by `dsh-tool-team`.

#### KV Cache effect

The bundle's composition is prefix-stable while its patch, Team identity, and configured tool schemas remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Opt-in only** — the package is public, but no shipped CLI, Web, SDK, ACP, or Python profile enables it.
- **Shared checkout** — every teammate observes the same working directory; this bundle adds no worktree isolation or filesystem locking.
- **Base profile required** — the patch depends on row ids and Subagent providers supplied by `dsh-base`; it is not a standalone profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
