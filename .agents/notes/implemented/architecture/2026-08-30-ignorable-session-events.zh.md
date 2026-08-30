# Agent Note: 在 Alpha 迁移期间保留明确标记为可忽略的会话事件

Status: implemented

[English](2026-08-30-ignorable-session-events.md) | 中文

## Problem

Alpha reader 会拒绝生成的 first-party 事件集合之外的所有事件类型。迁移后的 JSONL 会话包含由已挂载 Codex 搜索 provider 写入的 42 条 `web/codex-search-llm-request` 记录；每条记录都是不含密钥的请求审计，并带有明确的 `ignorable: true` 标记。如果 reader 不识别该标记，会话虽然完整存在，但无法打开历史。

## Decision

`SessionEvent` 接受可选的 `ignorable: true` envelope 字段，seed 校验只接受这个确切的布尔值。`PersistenceCoordinator` 继续拒绝所有没有该标记的未知事件，并允许带标记的未知事件通过而不解释其 payload。生成的 `KNOWN_SESSION_EVENT_TYPES` 集合仍是 first-party 必需事件的权威来源；该标记是信息性扩展记录的逐条明确例外，不是注册机制，也不是未知类型的默认行为。

Alpha JSONL 迁移保留已有的 `web/codex-search-llm-request` 标记记录，不删除、重命名或重写它们。Codex 请求审计包含解析后的 endpoint 和不含密钥的精确请求体，不参与 conversation surface 或 request-header 重建。未来 producer 只有在确认同样的非语义性质后才能写入该标记。

## Alternatives considered

**迁移时删除 Codex 请求记录。** 拒绝，因为删除会改变源历史并移除有用的请求审计证据；已有标记已经说明缺少该 provider 类型的 reader 可以跳过这些记录。

**接受所有未知事件类型。** 拒绝，因为无法识别的记录可能影响模型输入、恢复、策略状态或插件 projection。默认行为仍然是 fail-closed。

**把 Codex provider 事件加入 first-party 生成词汇表。** 拒绝，因为 provider 来自外部 package，把它变成 first-party 会让 core catalog 绑定某个部署专用实现。明确标记可以保持 repository-owned 事件集合与部署组合无关。

**增加 session-format 版本或重新编号迁移日志。** 拒绝，因为 JSONL 记录已经使用 v0 envelope 和有效的单调序列号。读取带标记记录不需要结构重写。

## Consequences

带标记的未知事件仍保留在加载后的 event list 中，因此 raw-log fidelity 和序列引用得到保持，尽管 core projection 会忽略它们。格式错误的标记、任何非 `true` 的标记值，或未知的必需事件，仍会拒绝 seed 或 persistence 加载。可选 envelope 字段是本次 JSONL 迁移的兼容读取路径，不会让其他 persistence backend 获得外部事件注册能力。

Core seed 校验、persistence coordinator 测试、生成的 persistence catalog 以及迁移会话扫描共同覆盖标记接受和 fail-closed 拒绝。扫描确认迁移的 42 条 Codex 请求记录全部带有 `ignorable: true`，177 个迁移会话日志均没有 torn Zstandard frame。
