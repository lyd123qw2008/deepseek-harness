# Agent Note: 为重试分类保留 OpenAI Responses 与 Codex 错误元数据

Status: implemented

[English](2026-08-14-pi-ai-server-overload-classification.md) | 中文

## 问题

OpenAI Responses 与 Codex 的失败可能只带着展示消息抵达 Harness。缺少提供方 code 和 HTTP 状态时，暂时的容量响应可能变成不可重试的 `PI_AI_ERROR`；Codex 的 `stream_transform_error` 或 HTTP/2 对端重置也会失去传输层含义。Codex 的非 2xx 处理还会把结构化错误改写成友好消息，除非保留其 body code 与响应状态。

## 决策

针对 `@earendil-works/pi-ai@0.82.1` 的本地 pnpm 补丁为 `AssistantMessage` 增加 `errorCode` 与 `errorStatus`。经过补丁处理的 OpenAI Responses 与 Codex 适配器会把提供方 code 和 HTTP 状态保留到终止错误中，包括 Codex SSE 错误与非 2xx body 元数据。经过补丁处理的 OpenAI Responses catch 也会通过 `onResponse` 报告暴露出来的非 2xx 响应标头。

`mapStopReason` 首先使用已识别的提供方 code。没有提供方 code 时，明确的 quota、billing 或 model-disabled 文案会在 HTTP 状态回退前保持终止语义；其它情况使用有效 HTTP 状态，并在缺少结构化元数据时最后使用扁平化文本。`stream_transform_error` 与窄范围 HTTP/2 reset 诊断映射为 `TRANSPORT`；瞬态的结构化 overload 与 server code 映射为 `SERVER`，而官方 Codex 的 `server_is_overloaded` 模型容量 code 保持终止型 `PI_AI_ERROR`（见 [Codex error 定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/error.rs) 与 [SSE 映射](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs)）。没有状态的未知 structured code 仍为 `PI_AI_ERROR`，泛化的 overload、internal-error 或 try-again 文案不是重试信号。适配器从非 2xx `ProviderResponse` 标头记录 Retry-After 与 request-id；成功的 2xx 响应信息不会装饰之后的流内错误。

`dsh-llm-retry` 扩展仍是唯一可见的重试 owner。pi-ai 保持 `maxRetries: 0`，适配器将 Codex 路由固定为 `transport: 'sse'`，即使 profile 配置其它 transport。这样可避免 WebSocket `response.create` 在首个事件前通过 auto fallback 重复发送请求；因此一次适配器流只发起一次模型生成请求，再由持久化的 agent 级策略决定是否重试。

## 考虑过的替代方案

**匹配 overload 文案。** 不予采纳：措辞不是提供方接口，无法区分容量错误与无关文本。只有不暴露结构化元数据的 API 才继续使用扁平化文本。

**让 `PI_AI_ERROR` 可重试。** 不予采纳：它还表示畸形的提供方响应和意外的 SDK 失败，重复请求没有已知的恢复价值。

**启用 pi-ai SDK 重试。** 不予采纳：隐藏的 SDK 尝试会绕开持久化的 `llm/retry` 记录，并叠加已配置的请求预算。

**把成功响应的标头附加到之后的所有错误。** 不予采纳：成功 HTTP 响应之后的流内错误不能证明该 HTTP 响应本身是瞬态失败；适配器把响应信息限制在非 2xx 状态。

## 验证

转换器测试覆盖 code 优先级、状态回退、结构化上下文窗口与瞬态 overload 分类、终止型模型容量分类、明确的 quota/billing/model-disabled 状态守卫、精确的 `stream_transform_error` 和 HTTP/2 reset 文案，以及泛化文本的负向用例。直接 patched OpenAI Responses 测试覆盖 type-only `response.failed` 元数据；直接 patched Codex 测试覆盖 SSE code 与 type-only 错误、`response.failed` 的 type 回退，以及 code、友好消息和状态都能保留的 503 JSON body。适配器测试覆盖 Codex 固定为单次 SSE 生成请求、非 2xx Retry-After 格式与 request-id 传递、有效响应状态过滤与已有 failure 字段保护、单生成请求的 SDK retry guard、2xx 流错误保护、取消和预算行为。`sdk-options.spec.ts` 继续固定 `maxRetries: 0`，`dsh-llm-retry` 测试继续覆盖有界的 `SERVER`、`RATE_LIMIT`、`TIMEOUT` 与 `TRANSPORT` 策略。

## 后果

- OpenAI Responses 与 Codex 的重试分类依据下游元数据工作，而不会把恢复范围扩大到未知 pi-ai 失败。
- 当 pi-ai 暴露响应标头时，非 2xx 提供方延迟与请求标识可以抵达 Harness 重试策略。
- 上游 API 将原始 `cause` 压平的传输失败仍只能尽力从文本分类；兼容回退及其理由见[扁平化传输注记](2026-07-22-pi-ai-transport-truncation-classification.zh.md)。pi-ai 未转发的 cause 无法由适配器层恢复。
- 未来升级 pi-ai 时必须重新应用并审查版本固定补丁；其哈希记录在 `pnpm-lock.yaml` 中。
