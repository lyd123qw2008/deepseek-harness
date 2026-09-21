# Agent Note: terminal 卡片容忍畸形的升权字段

Status: implemented

[English](2026-09-21-terminal-card-invalid-escalation-pair.md) | 中文

## 问题

一次成功的 shell 调用可能携带 Client 拒绝、而 Host 已经接受的可选升权字段。当命令请求的沙箱模式与现行模式相同时，`isRedundantEscalation` 让 Host 跳过 `validateEscalationArgs`，于是命令照常执行并以结果结算。Client 没有「冗余」这一概念：只要存在 `sandbox_permissions`，`validEscalationFields` 就要求 `justification` 非空，因此同一份参数让 `shellCall` 返回 null、`terminalCardModel` 返回 null，对话中的该行退化为不可点击的标题加摘要。命令与输出仍留在会话里——轨迹视图与 Details 依然可读——但该行失去了同一工具在 `pwsh` 调用上仍具备的展开能力，于是一次 shell 调用能否展开取决于模型给出的可选参数字段，而不是工具或平台。

## 决策

`terminalCardModel` 在调用本身已证明执行过时保留 shell 卡片。已结算、非错误、且单一结果文本存在的块把 `allowInvalidEscalation` 传入 `shellCall`，后者仅对该次调用跳过升权字段校验。其余规则一律保持严格：运行中、出错、后台、持久 shell 以及 spill 预览的调用携带畸形字段时仍走通用路径，`timeoutMs`、`workdir`、`run_in_background` 的校验与原先完全一致。卡片只渲染 `command`、`description`、`cwd`、输出与退出状态，从不展示升权字段，因此容忍它们不会错误呈现请求内容。

该容忍与 diff 卡片既有的规则一致：带有合法 `meta.diffs` 的成功变更即使其可选升权字段未通过 Client 校验也照常渲染，`diffCardModel` 以 `allowAppliedMetadata` 表达同一判断。本改动只在 Client 侧。Host 无需改动，因为它已经接受了该调用；升权合法性也未受影响：真正的升权请求仍需 Host 审批，任何 Client 决策都无法授予它。

## 考虑过的替代方案

**从 `shellCall` 彻底移除升权校验。** 不予采用：运行中的调用携带畸形字段时会渲染出一张权限尚未确定的 terminal 卡片，而既有畸形字段测试表正刻意钉住该回退。

**放宽 `validEscalationFields` 本身。** 不予采用：该辅助函数与文件变更工具共用，陈述的是字段配对自身的契约。容忍属于持有执行证据的卡片，而不属于所有调用方共享的校验器。

**在 Client 推导「冗余」判断。** 不予采用：Client 拿不到会话的沙箱策略，而把 `danger-full-access` 硬编码为「永远冗余」等于把 Host 规则搬进展示模型。

**依赖模型的参数卫生。** 不予采用：降级是静默的，而该行正是读者在对话中打开命令的位置，且只要工具 schema 广告了升权字段，同一个模型就会继续发出这对字段。

## 后果

已成功结算的 shell 调用只要结果文本存在就可展开，即使模型以空 justification 重申请了现行模式。Client 在恰好一种状态下刻意比 `validEscalationFields` 更宽松，因此两条规则必须一并阅读，且都由测试钉住。展示卡片的行仍只呈现结果携带的事实；该容忍无法把失败升级为成功，因为 `isError`、持久 shell 与 spill 预览的块仍走通用路径。

## 验证

[Terminal 卡片测试](../../../../packages/client/ui-tool/tests/terminal-card.client.spec.tsx)新增两个用例：已成功结算的调用携带「冗余 full-access + 空 justification」时保留卡片并保持命令原文；同一字段出现在出错调用与运行中调用时仍走通用路径；而既有的畸形字段测试表仍拒绝全部运行中的用例。`pnpm vitest run packages/client/ui-tool` 通过 17 个文件共 313 个测试，client 面以 `pnpm exec tsc -b tsconfig.client.json` 通过类型检查。重建 Client 产物后，一个真实 Web 会话把此前降级的行重新渲染为可展开，这也证实该改动无需重启 Host。

## 相关

- [嵌套 terminal 卡片](2026-09-05-nested-terminal-cards.zh.md) —— 负责 terminal 卡片适用性；其「格式错误的输入保留通用回退」一段现在需连同本文的「成功结算容忍」一并阅读。
- [Client 派生工具展示](../architecture/2026-08-23-client-derived-tool-presentation.zh.md) —— 负责 Client 展示所有权。
- [本分支独占的 DSH 特性及其升级处理](../process/2026-09-16-local-exclusive-upgrade-treatment.zh.md) —— 把本容忍列入升级时必须保留或刻意退役的本地分歧。
