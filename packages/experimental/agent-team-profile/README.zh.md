---
description: "叠加在 dsh-base 上公开发布的实验性 Agent Teams Host profile 层，由 Team-aware preset 选择模型侧协作工具并保留一次性 delegation。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-agent-team-profile

[English](README.md) | 中文

## 概述

`dsh-experimental-agent-team-profile` 是在 `@deepseek-ai/dsh-base` 之上提供 [Agent Teams](../agent-team/README.zh.md) Host 服务的公开实验性 profile 层。它的 patch 会插入持久 Team domain、禁用名称重叠的全局 continuable-child control，并保留普通的一次性 fresh 与 fork delegation 工具。模型侧 Team policy 与工具由显式选择 Agent Teams 的 Team-aware preset 挂载，因此普通 preset 不会被注入 Team 能力。dsh 安装随附本包作为可选组合包，随附 profile 都不会启用它；可在 Web 侧栏的插件页开启，或显式添加到已初始化的 profile。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

将本包添加到已初始化的 profile，然后运行一个要求 Lead 委派工作的任务：

```sh
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
dsh --profile headless "Use Agent Teams to split this task between two teammates, wait, and summarize."
```

profile 必须已经包含 `@deepseek-ai/dsh-base`，本层会使用其中的 Subagent service 与 provider 配置行。执行 `dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-agent-team-profile` 移除本包时，bundle 也会从 profile 的有序层列表中移除。

### 获得的功能

本层会添加持久 Agent Teams domain，禁用工具名与 Team control 重叠的全局 continuable-child control 行，并保留 `subagent` 与 `subagent_fork` 作为一次性 delegation 工具。Team policy 与九个 Team 工具不在 Host 层全局挂载；需要它们的 profile 应在对应的 Team-aware preset 中显式加入 `@deepseek-ai/dsh-experimental-tool-agent-team`，这样普通 preset 不会看到 Team 能力。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包的运行时内容是 [`cordis.patch.yml`](cordis.patch.yml)。在 `dsh-base` 之后应用时，patch 会禁用 `tool-subagent-control` 与 `tool-subagent-list-agents`，把 fresh 与 fork Subagent 行设置为 `one-shot`，并以显式 provider 和限制插入 Team service。模型侧工具行由 Team-aware preset 自己挂载，避免 Host 层把 Team policy 注入每个普通会话。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 叠加在 `dsh-base` 之上的有序 patch |
| [`src/index.ts`](src/index.ts) | 空模块入口；patch 是运行时内容 |
| — | 不发布运行时不变式伴生入口；本包是静态 bundle，不持有可独立观察的运行时关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [实验性包](../README.zh.md)——孵化状态与发布规则。
- [Agent Teams service](../agent-team/README.zh.md)——持久 roster、消息与任务板行为。
- [Agent Teams 工具](../tool-agent-team/README.zh.md)——Team-scoped 模型工具表层。
- [Base bundle](../../bundle/base/README.zh.md)——本 patch 扩展的 profile 层。

-----

<a id="model-experience"></a>
## 模型体验

### Team 策略与工具

#### 模型会看到什么

当一个 Team-aware preset 显式挂载 [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.zh.md) 时，模型才会看到 Team policy 与 Team-scoped `list_agents`、`send_message`、`interrupt_agent` 等工具；它们会在该 preset 的 Agent scope 内替代已禁用的全局 continuable-child control。普通 preset 不会获得这些模型侧输入。`subagent` 与 `subagent_fork` 仍作为一次性 delegation 工具可用，其子 agent 不会获得 continuable-child `report` 工具。

#### Token 影响

Host profile 本身不向普通会话加入 Team policy 或工具 schema；Team-aware preset 的模型请求才承担 `dsh-tool-team` 描述的固定提示词与 schema 成本。

#### KV Cache 影响

只要 bundle patch、Team identity 与配置的工具 schema 不变，本 bundle 的 composition 就保持前缀稳定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅显式启用**——本包公开发布，但随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它。
- **共享 checkout**——所有 teammate 都观察同一个工作目录；本 bundle 不提供 worktree 隔离或文件系统锁。
- **需要 base profile**——本 patch 依赖 `dsh-base` 提供的配置行 id 与 Subagent provider；它不是独立 profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
