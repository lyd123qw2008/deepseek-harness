# Agent Note: Import standalone Codex CLI sessions

Status: implemented

English | [中文](2026-08-14-codex-session-import.md)

## Problem

独立 Codex CLI 的 rollout 文件是使用产品专用事件词汇的 JSONL 文档。DSH 持久化只接受自身版本化的 `SessionEvent` 日志，并会拒绝外部 header 或事件记录，因此不能直接复制 Codex 文件来创建 DSH 会话。可用的导入必须保留后续 DSH 请求所需的有序对话和工具历史，同时拒绝无法忠实表达的记录。

## Decision

仓库提供 `scripts/import-codex-sessions.ts` 和根命令 `import:codex-sessions`。它递归读取 rollout 文件，要求第一条记录是合法的 `session_meta`，并为每个源会话创建 ID 为 `codex-<source-id>` 的 DSH 会话。解析器映射实际用户文本、assistant 文本、可识别的 function/custom tool 调用及输出、轮次边界、工作目录和创建时间。Codex developer/system 消息、注入的 Harness 指令、加密 reasoning、Codex request header 以及未知记录类型不会写入 DSH 模型 transcript；不支持的记录会计数并报告。

导入器通过 `Session` 构造已验证的 DSH 事件，再通过 `SessionStore` 和 `JsonlSessionPersistence` 使用配置的 Zstandard 编码发布。已有 ID 会跳过，源文件不会被写入，单个源文件的失败会隔离，`--dry-run` 会执行解析和校验但不会创建目标持久化根目录。每个新 artifact 的发布仍由后端负责。

导入日志不携带 Codex request header。因此后续 DSH prompt 会在 DSH 会话解析出的 preset、system prompt、工具 schema 和当前模型路由下恢复持久化对话。结果是可继续的 DSH 对话，而不是 Codex 运行时的精确重启；历史 assistant provenance 会在可用时标出源 provider 和模型。

## Alternatives considered

直接把 Codex JSONL 文件复制到 DSH 持久化根目录被否决，因为 DSH 会校验自己的 header、事件 envelope 和事件词汇。通过现有 Codex subagent provider 继续对话被否决，因为该 provider 有意创建临时的一次性 thread，并且只返回最终答案。让每个 DSH 持久化后端都接受 Codex 记录也被否决，因为这会把外部产品格式变成 DSH 存储契约的一部分；导入器将转换保留在明确的源码仓库命令中。

## Consequences

Web 历史加载可以显示导入的会话而不启动 Agent。用户发送第一条新 prompt 时使用现有 API resolver 的冷恢复路径，因此 DSH 的所有权、工作区、preset、模型和审批策略照常生效。在 Web 的工作区视图中，带有 `cwd` 但没有持久化 Workspace 记账的会话会进入按目录 basename 命名的浏览器本地 cwd 分组；这种展示不会修改 Host Workspace 所有权。大量导入前应先运行 dry-run，因为即使源文件结构都有效，也可能包含很多不支持的 Codex 记录。

导入器是源码仓库命令，不是新的已安装 launcher 模式。它有意不导入图片、加密 reasoning、provider request state 或任意 Codex 记录。解析器和持久化测试覆盖成功映射、不支持记录、损坏 header、重复导入、持久化重新加载以及 dry-run 不物化目标目录。

## Verification

`pnpm exec vitest run scripts/import-codex-sessions.spec.ts --reporter=dot` 覆盖解析器和持久化路径。对已配置 Codex 历史执行的真实 dry-run 校验了 314 个源文件，识别出 301 个可导入会话和 13 个空 rollout，且没有损坏源文件。
