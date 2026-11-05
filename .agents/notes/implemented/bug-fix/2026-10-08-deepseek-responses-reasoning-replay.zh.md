# Agent Note: 回放时恢复 DeepSeek Responses 推理文本

Status: implemented

[English](2026-10-08-deepseek-responses-reasoning-replay.md) | 中文

## 问题

DeepSeek Responses 思考模式要求每个后续请求都携带此前的 `reasoning_text` 项。DeepSeek 兼容流可能在终结 reasoning 项中漏掉 `content`，或返回下一个请求无法校验的加密 reasoning，导致工具续接或后续轮次收到 HTTP 400。

## 决策

模型级 `reasoningReplay` 策略控制 `openai-responses` reasoning 回放；省略时默认为 `native`，保留捕获的提供方签名。`durable-text` 只使用持久化 `reasoning` 块文本重建 `{ type: 'reasoning', content: [{ type: 'reasoning_text', text }] }`，并丢弃仅属于响应或网关透传的字段；持久化块没有文本时不生成回放签名。保存响应时，适配器只对 Responses 输出应用此策略；重建历史时，若目标模型选择该策略，它会应用于匹配的提供方/模型消息，包括使用其他协议记录的历史。这是 [pi-ai 回放投影](../architecture/2026-07-14-provider-routed-llm-adapters.zh.md)的模型专用例外；需要加密 reasoning 连续性的提供方仍使用 `native`。源 Web Profile 为 DeepSeek `deepseek-flash` 选择 `durable-text`。

## 备选方案

**将路由切换为 Chat Completions。** 这会改变已配置协议，且不能修复已有的 Responses 历史。

**在第二个回放字段存储流式 reasoning。** 持久化 reasoning 块已经记录模型可见文本，并能跨会话重建它。

**仅移除已知不支持的字段。** 网关可能添加 `summary` 和 `encrypted_content` 以外的透传字段；按白名单重建可以阻止这些字段进入 DeepSeek 输入。

**根据提供方名称推断策略。** 名为 DeepSeek 的路由仍可能连接要求原生加密签名的 Responses 网关；模型级显式配置让选择可审查。

**对所有 Responses 提供方使用 durable-text。** 依赖加密签名保持连续性的提供方不能安全地用纯文本重建 reasoning。

## 影响

使用 `durable-text` 时，当前及已持久化的匹配 Responses 消息会在工具续接和后续轮次携带持久化 reasoning 文本，而不发送响应专用或网关元数据。使用 `native` 或省略策略时，签名保持不变。适配器无法恢复从未持久化的 reasoning，因此 `durable-text` 在空块上不发送 reasoning 项。
