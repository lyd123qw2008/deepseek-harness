# Agent Note: Delegated children inherit the active model effort

Status: implemented

[English](2026-08-14-delegated-children-inherit-active-model-effort.md) | 中文

## 问题

Web 模型选择器会在父级的 `request/header` 中记录活动提供方、模型和推理强度，但进程内子级驱动此前只复制父级静态的 provider/model/maxTokens 选项。子 agent 自身没有 Web 选择监听器，缺失的强度会作为适配器回退值发送。于是 Codex Gateway 会对只接受 `max` 等具名强度的模型发送 `none`，子 agent 在开始工作前即失败。

## 决策

`AgentOptions` 携带可选的显式 `reasoningEffort`。AgentLoop 会把它用于全新路由；匹配的持久化 header 仍具有权威性，且不会把适配器实体化的默认值固定下来。Web API 网关和 headless runner 会把默认模型选择的三个字段全部写入新 Agent。

`resolveChildAgentOptions()` 会在两个进程内驱动等待子级创建前，快照父级请求 header 中的活动提供方／模型路由及其显式推理强度。它不会复制适配器默认值标记；请求若覆盖提供方或模型，所需的非默认推理强度必须由该请求显式指定。一次性与可继续驱动都使用该解析器；可继续启动会在提供方准备前快照其结果，并把已解析路由写入现有描述符，使冷恢复使用建立该子级的路由。已完成过请求的子级会从自己的持久化请求 header 恢复显式推理强度。

## 考虑过的替代方案

**为每个子级安装 Web 模型选择器。** 被否决，因为这会把所有进程内委派耦合到 Web 传输，并赋予子级并不拥有的会话选择所有权。

**只复制 `parent.options`。** 被否决，因为该对象不反映会话本地模型选择，且原本不包含已选推理强度。

**把适配器实体化的默认值复制成显式推理强度。** 被否决，因为使用另一个请求路由的子级可能拿到不受支持的值，而非解析那个路由自己的默认值。

## 测试

`packages/core/agent-loop/tests/loop.spec.ts` 证明全新的 `AgentOptions.reasoningEffort` 会到达请求。一次性与可继续的进程内继承测试证明，含有 `max` 的活动父级 header 会成为子级请求。无密钥 headless subagent 快照通过真实 Loader 组合记录相同的子级 header；重启后的本地 DSH Web 会话则会执行真实 Codex Gateway 子级。

## 后果

被委派的 Codex 子 agent 会复用父级显式选择的 `max` 等推理强度，而不再悄然回退为 `none`。有意更换提供方或模型的子级会使用该路由的默认值，除非调用方同时选择推理强度。没有持久化格式变更：显式子级推理强度本就属于子级请求 header，而可继续描述符仍只负责可重建的路由和组合。
