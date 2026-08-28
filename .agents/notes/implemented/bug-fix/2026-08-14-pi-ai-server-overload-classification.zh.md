# Agent Note: 保留 provider 失败事实以支持模型重试分类

Status: implemented

[English](2026-08-14-pi-ai-server-overload-classification.md) | 中文

## Problem

Provider 失败可能只以通用显示文本抵达 Harness。没有稳定的重试代码时，瞬时容量响应或传输重置会变成不可重试的 `PI_AI_ERROR`，而 provider 响应中的重试等待时间与请求标识也会丢失。

## Decision

`dsh-llm-pi-ai` 在可用时从 pi-ai 保留的消息元数据和 pi-ai 0.84 diagnostic 中分类 provider 失败代码；对于将元数据压平成 `errorMessage` 的 API，则使用窄范围的 token 回退。瞬时服务器、限流、超时与传输代码映射到 Harness 的重试词汇。配额、计费、模型禁用、模型不可用以及 provider 专用的 `server_is_overloaded` 容量代码保持为终态。HTTP/2 流重置和 `stream_transform_error` 文本映射为 `TRANSPORT`；单独出现的通用 overload 或 internal-error 文案不会成为重试信号。

适配器通过请求的 `fetch` 选项捕获每个 HTTP 响应，同时接受 pi-ai 的 `onResponse` 回调。它只在错误完成结果上保留非 2xx 状态、`Retry-After`/`Retry-After-Ms` 与常见请求 id header。2xx 响应不能装饰其后发生的带内流错误。当通用错误没有更强的终态或重试分类时，其非 2xx 状态提供重试代码。

适配器保持 `maxRetries: 0`，并将 Codex response 路由固定为 SSE。`dsh-llm-retry` 仍是可见模型重试、持久化 `llm/retry` 事件、退避与重试预算的唯一所有者。因此，一次适配器流在 Harness 重试策略决定是否重新开始之前，只代表一次模型生成尝试。

## Alternatives considered

**让所有 `PI_AI_ERROR` 都可重试。** 否决，因为该代码也表示格式错误的请求、不可用模型和没有已知恢复价值的 SDK 异常。

**在 pi-ai 内部重试。** 否决，因为隐藏的 SDK 尝试绕过持久化的 `llm/retry` 记录，并会放大配置的请求预算。

**匹配任意 overload 或 internal-error 文案。** 否决，因为显示文案不是 provider 接口，也可能描述终态的模型或账户情况。可接受的信号仍是结构化代码、响应状态和窄范围传输标记。

**把成功响应当作后续流错误的证据。** 否决，因为 2xx 响应之后发生的带内错误不能证明原 HTTP 响应是瞬时失败。

## Consequences

瞬时 provider 失败可以进入配置的 `SERVER`、`RATE_LIMIT`、`TIMEOUT` 或 `TRANSPORT` 重试策略；当 provider 提供这些信息时，重试还会携带响应等待时间与请求标识。终态的账户和模型失败会直接显示，不会被重试。pi-ai 丢弃的传输原因仍只能依靠最佳努力的文本分类；适配器无法恢复已经从事件中消失的原因。

聚焦的适配器与转换器测试覆盖 SDK 单请求行为、响应事实传递、provider 代码优先级、终态容量与账户情形、diagnostic 以及 HTTP/2 传输文案。Provider 路由重试测试继续覆盖持久化退避与预算行为。
