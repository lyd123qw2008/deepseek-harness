# Agent Note: 为重试分类保留 OpenAI Responses 错误元数据

Status: implemented

[English](2026-08-14-pi-ai-server-overload-classification.md) | 中文

## 问题

OpenAI Responses 错误抵达 Harness 时只剩 pi-ai 的 `errorMessage`。原始提供方 `error.code` 和 HTTP 状态被丢弃，重试分类因而依赖不稳定的展示文本。即使下游 API 已将暂时容量问题标识为服务端失败，它仍可能变成默认不可重试的 `PI_AI_ERROR`。

## 决策

针对 `@earendil-works/pi-ai@0.82.1` 的本地 pnpm 补丁为 `AssistantMessage` 增加 `errorCode` 与 `errorStatus`。它的 OpenAI Responses 适配器会把 SDK 错误的 code 和 HTTP 状态写入终止错误，并在该适配器捕获之前保留响应流错误 code。

`mapStopReason` 先映射已识别的提供方 code，再映射 HTTP 状态，最后才对没有这两个元数据字段的协议使用扁平化文本。结构化上下文窗口 code 也优先于基于文本和 usage 的溢出检测。`SERVER` 和 `RATE_LIMIT` 仍是 normal 策略的可重试 code；路由继续拥有重试次数与指数退避设置，通用兜底 `PI_AI_ERROR` 则默认不可重试。

## 考虑过的替代方案

**匹配服务端过载文案。** 不予采纳：措辞不是提供方接口，无法区分容量错误与无关文本。只有不暴露元数据的 pi-ai API 才继续使用扁平化文本。

**让 `PI_AI_ERROR` 可重试。** 不予采纳：它还表示畸形的提供方响应和意外的 SDK 失败，重复请求没有已知的恢复价值。

**将 normal 策略的默认次数提高到五次。** 不予采纳：重试次数由每个提供方路由的运维方选择，默认上限与这项分类保持独立。

**启用 pi-ai SDK 重试。** 不予采纳：隐藏的 SDK 尝试会绕开 agent loop 的持久化 `llm/retry` 记录，并叠加已配置的请求预算。

## 验证

pi-ai 转换器测试会验证提供方 code 相对于冲突状态和展示文本的优先级、仅有状态的服务端分类，以及结构化上下文窗口分类；`dsh-llm-retry` 覆盖会验证带指数退避的有界 `SERVER` 重试。

## 后果

- OpenAI Responses 重试会依据下游元数据工作，而不会把恢复范围扩大到未知的 pi-ai 失败。
- 提供方路由可以为 `SERVER` 或 `RATE_LIMIT` 选择五次有界重试，而无效的 `unsupported_value` 请求仍保持终止。
- 未来升级 pi-ai 时必须重新应用并审查这个版本固定的补丁；其他 pi-ai API 在暴露等价元数据前仍保留旧式文本兜底。
