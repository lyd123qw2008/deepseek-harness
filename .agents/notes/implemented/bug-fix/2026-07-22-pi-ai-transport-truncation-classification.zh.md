# Agent Note: 从扁平化的消息文本中分类 pi-ai 传输层截断

Status: implemented

[English](2026-07-22-pi-ai-transport-truncation-classification.md) | 中文

## 问题

一些 pi-ai API 仍会把流式输出中途的连接断开呈现为单一的 `terminated` 通知，把被截断的 Anthropic 响应呈现为 `Anthropic stream ended before message_stop`。两者都是传输层截断——连接在提供方的终止 SSE（Server-Sent Events）事件之前就已断开——但 `dsh-llm-pi-ai` 只能在没有提供方 code 时从这些扁平化消息中分类。经过补丁处理的 OpenAI Responses 与 Codex 路径会在这个回退之前使用结构化元数据。

对于在推送终止 `error` 事件前压平捕获错误的 API，细节丢失发生在上游，且适配器无法恢复：pi-ai 把错误缩减为 `error.message`，丢弃原始 `Error` 及其 `cause` 链。undici 将可据以采取行动的 `SocketError` 放在 `cause` 上，却只交给 fetch 包装层一个裸的 `terminated`；pi-ai 只保留这个词。`onResponse` 在响应体被消费前观察 HTTP 响应，无法恢复之后才发生的流式断开 `cause`。

## 决策

- `classifyFlattenedPiAiError` 识别另外两种传输层措辞，并将两者都映射为 `TRANSPORT`：
  - 流式输出中途的套接字断开，呈现为裸的 `terminated`（undici）或 `Premature close`（Node 流层）；
  - 在终止事件之前被截断的流，每个 pi-ai 提供方各自抛出不同措辞（`Anthropic stream ended before message_stop`、`… before a terminal response event`、`… ended without a terminal event`、`Stream ended without finish_reason`），统一按 `stream ended before/without` 匹配。
- `classifyFlattenedPiAiError` 保留为仍会把原始传输失败压平成文本的 API 的兼容回退。OpenAI Responses 与 Codex 的结构化 code 和 status 决策记录在[结构化 metadata 注记](2026-08-14-pi-ai-server-overload-classification.zh.md)中。
- `llm-pi-ai/README.md` 记录没有保留元数据的 API 会从扁平化传输消息中进行文本分类，并说明结构化的 OpenAI Responses/Codex 元数据优先。

对于会压平传输失败的 API，分类继续基于消息文本，因为这是 pi-ai 交付的唯一信号。经过补丁处理的 OpenAI Responses 与 Codex 路径会在这个回退之前分类其保留的元数据。

## 考虑过的替代方案

**通过 pi-ai 的 fetch/dispatcher/client 钩子捕获 `cause`。** 否决：pi-ai 没有能在流式 body 失败、错误事件被压平之前观察它的钩子。`onResponse` 在响应体被消费之前触发，因此无法观察之后的断开。Anthropic 路径接受一个 `client` 对象，但为拦截传输错误而为每个请求构造并注入一个提供方 SDK client，只为一个诊断字符串就越过了适配器的服务边界。

**把两者都保留为 `PI_AI_ERROR`，并放宽 `llm-retry` 的可重试集合。** 否决：`PI_AI_ERROR` 是真正未分类失败的兜底，其中包括不可重试的失败（畸形的提供方响应、意料之外的 SDK bug）。让兜底可重试会重试那些永远不会成功的失败；修复之道是分类出可恢复的那种情况，而不是模糊这个类别。

**在适配器里把扁平化后的错误包装成 `LlmError('TRANSPORT', { cause })`，仿照 DeepSeek 适配器。** 对会压平提供方错误的 API 否决：DeepSeek 适配器包装的是拿到响应之前的 `fetch` 拒绝，其 `cause` 仍然完好；而 pi-ai 终止事件只有字符串，没有可链接的 `cause`。包装只会增加一层却恢复不了任何东西；分类是唯一还能增加的价值。

## 后果

- 流式输出中途的传输层断开和终止前的流截断现在都携带 `TRANSPORT`，因此组合出的 `llm-retry` 策略会默认重试它们，而不是让该轮次失败。
- 通知文本不变（`terminated` / `Anthropic stream ended before message_stop`）：cause 细节在适配器看到之前就已丢失，因此 `errorChain` 没有更多内容可渲染。只有被路由的 `code` 得到了改善。
- 对仍会压平这些错误的 API，分类仍然依赖字符串匹配和提供方措辞：未来某个 pi-ai 版本若改写它们，就会静默回退到 `PI_AI_ERROR`，直到模式被更新。结构化的 OpenAI Responses 与 Codex 错误则使用保留的 code 和状态。
