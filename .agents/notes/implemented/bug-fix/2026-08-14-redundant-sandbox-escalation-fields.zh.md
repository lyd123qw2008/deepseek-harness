# Agent Note: 已覆盖的 sandbox 升级字段保留常驻策略

Status: implemented

[English](2026-08-14-redundant-sandbox-escalation-fields.md) | 中文

## Problem

兼容 OpenAI 的 coding client 可能在会话已经运行于目标模式后，仍在工具调用中保留 `sandbox_permissions`。本次修复前，`dsh-tool-bash`、`dsh-tool-pwsh` 和 `dsh-tool-fs` 会在解析常驻策略前校验附带的 `justification`，因此继承的空值或缺失值会以 `invalid justification` 失败。非空的继承值则会进入 `approveEscalation`，并以无关的非严格放宽错误失败。在不提供 approval 的组合中，这两种情况都无法执行，尽管它们没有请求额外权限。

## Decision

`dsh-sandbox` 导出 `isRedundantEscalation`，它只识别已被已知有效模式覆盖的已知目标。该谓词绝不把未知目标或未知有效模式归类为冗余。

bash、PowerShell 与文件系统工具消费方会在校验升级参数对之前解析其常驻策略。冗余的已知目标会绕过成对参数校验和 `approveEscalation`，随后按未变的常驻策略执行。不会创建 approval 请求、授权或策略模式变更。

每个会改变权限的请求仍保留[沙箱决策](../feature/2026-07-06-sandbox.md)中的既有路径：成对参数校验、针对有效模式的严格放宽，以及执行前的 approval。文件系统路径仍按[跨家族决策](../feature/2026-07-14-cross-family-fs-sandbox.md)与 shell 路径保持一致。

## Alternatives considered

**拒绝每一个非放宽请求。** 否决，因为在已经覆盖的策略下，继承的标准工具字段只是无操作元数据，却会阻止本来允许的操作执行。

**放宽 `approveEscalation`。** 否决，因为共享 approver 仍是会改变权限的 fail-closed 边界。规范化属于消费方；那里可以取得完整的常驻策略，且尚未开始任何 approval 副作用。

**忽略每一种格式错误的升级参数对。** 否决，因为可能改变权限的请求仍需要面向用户的非空理由。只有已知且已被覆盖的目标才绕过该要求。

## Consequences

已经处于 `workspace-write` 或 `danger-full-access` 的会话可以接受继承的、匹配或更窄的已知目标，而不会发起 approval 提示，其中包括继承的 `justification` 为空或缺失的情况。未知模式、没有策略的组合，以及任何会拓宽权限的目标都保留既有的校验和 fail-closed 行为。

聚焦单元覆盖固定了共享分类、bash、PowerShell 和文件系统行为，其中包括空理由和缺失理由的情况。既有的直接 `approveEscalation` 测试继续固定：抵达会改变权限边界的非放宽调用会被严格拒绝。
