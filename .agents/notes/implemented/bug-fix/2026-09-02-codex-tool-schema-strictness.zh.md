# Agent Note: Codex 工具模式使用明确的非严格采样

Status: implemented

[English](2026-09-02-codex-tool-schema-strictness.md) | 中文

## Problem

pi-ai 的 `openai-codex-responses` 适配器在两个共享工具转换调用中都传入了 `strict: null`。`convertResponsesTools()` 将 `undefined` 视为非严格默认值，但收到显式值时会把 `null` 序列化出去。提供方收到可空的 strict 标志后，可能拒绝工具定义，或产生与 DSH schema 不同的行为。`session_search` 等 DSH 工具使用可选属性，不能被静默转换为严格 schema。

## Decision

`@deepseek-ai/dsh-llm-pi-ai` 使用的 `@earendil-works/pi-ai@0.84.2` 本地 pnpm 补丁在延迟工具消息转换和即时请求体转换中都传入 `strict: false`。这个布尔值明确表达提供方意图，并保留原始 JSON Schema。在 pi-ai 中，只有 `strict === true` 才会调用严格 schema 转换；该转换会把可选属性变为可空属性，并加入 `required`。因此，`strict: null` 不会触发 pi-ai 本地的这种转换，但仍然是不应发送给提供方的无效或含义不明确的值。

本修改不改变 DSH 工具 schema，不修正模型生成的参数，也不移除空可选数组的校验。模型发送 `session_ids: []` 时仍会得到现有的参数校验错误。`openai-responses` 适配器是独立路径，其转换器已经使用非严格默认值；本修复针对 Codex Responses 适配器。

## Alternatives considered

**启用严格采样。** 拒绝，因为它会把可选 DSH 属性改成可空的必填属性，并要求使用不属于 DSH 工具契约的 schema。

**在模型返回后过滤或修正工具参数。** 拒绝，因为这会隐藏无效的提供方/模型交互，并改变工具输入含义，而不是修复请求定义。

**把所有 DSH 工具 schema 改成严格模式兼容格式。** 拒绝，因为可选字段属于公开工具契约，严格性应是提供方转换选择。

## Testing

适配器回归测试通过 pi-ai 的 `onPayload` 钩子捕获 Codex 请求，不访问网络。测试同时检查即时和延迟工具定义，断言 `strict: false`，并将包含可选 `session_ids` 的 schema 与发出的参数比较；该字段仍不在 `required` 中，也没有被包裹成可空联合。Alpha.3 0.84.2 树的定向适配器测试通过。

## Consequences

直接 Codex 请求现在携带布尔型非严格标志，同时保留可选 DSH 参数。只有工具通过 pi-ai 的 constrained-sampling 配置明确请求时，约束采样才会启用。未来升级 pi-ai 时必须重新应用并检查版本固定的补丁片段，并刷新 `pnpm-lock.yaml` 中对应的 `patch_hash`。
