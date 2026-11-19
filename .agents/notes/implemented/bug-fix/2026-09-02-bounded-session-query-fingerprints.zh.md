# Agent Note: 受限的 session-query fingerprint

Status: implemented

[English](2026-09-02-bounded-session-query-fingerprints.md) | 中文

## Problem

SQLite 会话对账曾使用一个 `JSON.stringify({ header, events })` 值为每个被观察的会话计算 fingerprint。大型持久化 JSONL 会话可能在文档进入 SQLite 之前就超过运行时字符串限制，并以 `SESSION_QUERY_PERSISTENCE_FAILED` 和 `Invalid string length` 失败；提高模型工具超时并不能消除该失败。

## Decision

`@deepseek-ai/dsh-session-query-sqlite` 使用流式 SHA-256 哈希计算观察 fingerprint。它先哈希一次分离后的 header，然后使用带长度前缀的每条分离事件 JSON 序列化结果更新哈希。`observeSession()` 保留现有的分离事件与语义文档所有权，但不再为完整事件日志构造一个 JSON 字符串。实时与持久化观察继续使用同一套 fingerprint 算法，且该哈希仍是内存中的变更检测值，不属于持久化格式字段。

## Testing

SQLite 对账套件用 sentinel 拒绝 header 与事件的聚合序列化，同时仍能完成持久化搜索。Alpha.3 隔离归档在该修复后首次对 197 个会话执行 `DiffBlock` 搜索，耗时 191466 ms；后续的 `DiffBlock` 与 `invalid justification` 搜索分别耗时 2071 ms 和 739 ms。

## Alternatives considered

**只提高 `searchTimeoutMs`。** 否决，因为运行时字符串构造会在搜索返回前失败，与调用方的等待预算无关。

**跳过日志过大的会话。** 否决，因为派生索引会静默遗漏可搜索历史，使结果集依赖未文档化的大小阈值。

**对持久化会话使用 persistence revision 作为 fingerprint，而对实时会话保留聚合序列化。** 否决，因为这会产生两套 fingerprint 规则，并让大型实时会话暴露于同一运行时限制；一套受限算法可以保持变更检测一致。

## Consequences

首次搜索仍需检查并索引派生数据库中不存在的会话，同步 SQLite 工作仍不可抢占。会话完成索引后，未变化的会话会被复用，后续搜索不再扫描历史日志。组合序列化事件日志超过运行时字符串限制不会再单独导致 fingerprint 计算失败。

派生索引仍可丢弃，并且与 JSONL 会话持久化分离。带长度前缀的序列保证事件变化会产生不同 fingerprint，但 fingerprint 本身不会暴露事件内容。

本修复属于[SQLite FTS5 会话搜索决策](../../archived/feature/2026-07-10-sqlite-session-query-provider.md)下的实现纠正；它不改变搜索授权、索引范围、tokenizer 行为或游标语义。
