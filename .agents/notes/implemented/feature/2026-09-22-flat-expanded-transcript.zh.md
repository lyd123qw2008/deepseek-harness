# Agent Note: 完全展开模式的平铺对话

Status: implemented

[English](2026-09-22-flat-expanded-transcript.md) | 中文

## 问题

0.1.7 在三种「工作过程展示」模式下都把已完成的轮次折叠到整轮控件之后，并让每个过程组保留自己的组头。阅读长会话的人会看到自己并未要求的多层折叠，而且没有任何设置能去掉：`presentation-policy.ts` 对 `compact`、`detailed`、`expanded` 一律设置 `foldCompletedTurns: true`，因此选择最开放的模式仍会把过程行藏在控件后面。

## 决定

`expanded` 成为本分支的平铺模式。它的策略改为 `foldCompletedTurns: false`，同时 `ChatGroupSeat` 只按 `stepGrouping` 决定是否分组，于是没有步骤分组的模式在历史轮次与运行中轮次都不再渲染组头。`expanded` 下整轮控件不再挂载，每一行过程就位显示，恢复 Alpha.2 的阅读体验。

`compact` 与 `detailed` 保留上游行为：整轮控件、组头与初始收起的组正文都照旧。锁定 `expanded` 分组与分页锚点的上游用例已收窄到这两个模式，策略、折叠与分页可见性用例改为断言 `expanded` 的平铺契约。

## 考虑过的替代方案

**新增第四种模式。** 否决：用户要的就是他已经在用的那个模式，再加一行设置只会多一个没人需要的选项。

**保留组头但默认展开。** 否决：要移除的杂波正是组头行，而正文无论开合都会渲染，默认展开并不改变阅读路径。

## 后果

`expanded` 下已完成的轮次没有可展开的折叠，因此「浏览器查找揭示隐藏内容」这条路径在该模式不再适用；`compact` 与 `detailed` 仍然保留。该模式不设限高地渲染每一行，很长的会话会比折叠模式滚动得更远。

## Related

- [本地独有 DSH 特性及其升级处理](../process/2026-09-16-local-exclusive-upgrade-treatment.zh.md) — 升级在采用这些文件的发布版之前查阅的清单。
- [Web 轮次过程折叠](../../archived/feature/2026-08-14-web-turn-process-folding.md) — 本模式所拒绝的已发布折叠设计。
