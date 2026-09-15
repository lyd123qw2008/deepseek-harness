# Agent Note: Web diff 卡片通过滚动视口渲染

Status: implemented

[English](2026-09-15-web-diff-card-scroll-viewport.md) | 中文

## Problem

Web diff 卡片最初按整段新旧两侧渲染，配合首尾高度上限和一个展开按钮（[Web diff 卡片](../../archived/feature/2026-07-30-web-diff-card.md)）。该设计把上限花在未改动的文本上：大片段里的一处小改动会被挤出折叠视图，而展开控件夹在同一处改动的首尾切片之间。

本分支把该呈现换成客户端推导的滚动视口。随后官方发布落地了一套独立的上下文 diff 实现（每侧三行上下文的 `structuredPatch`、折叠，以及有界的编辑距离搜索），并把 `diff-block.client.spec.tsx` 的 `DiffBlock local changes` 块改写成指定它的样子。代码升级会保留经审查的本地文件、整体接收官方文件，于是官方测试块进来了，而 `DiffBlock.tsx` 与 `DiffBlock.module.css` 仍留在本地。测试套件随后针对一个从未采用该设计的实现失败了四条断言，唯一钉住视口的两个本地测试文件成了留存者，这使该表面的契约分裂在两种设计之间。

## Decision

卡片把 hunk 的每一行渲染进纵向滚动的正文，正文高度由 `maxHeight` 限制在 `DEFAULT_DIFF_MAX_LINES`（10）内容行，`maxLines: Infinity` 取消该上限。没有展开控件，也没有折叠区间：读者通过正文自己的滚动条看到改动的其余部分，因此改动不会被控件藏起来，改动行也留在原位。

在每个 hunk 内，浏览器用维护中的 `diff` 库重复行比较，而不是消费行标记，因为 `FileDiff` 契约携带的是前后文本而非带标记的补丁，也从不携带增删统计。改动之间每一段未改动内容只贡献一行中性上下文。这条"一行"规则正是让长段未改动内容不会挤掉改动的原因，也是记录在案的"每侧三行上下文"远端行为在此不适用的原因。

当 hunk 存有 `oldStart`/`newStart` 时，单行替换会把两侧渲染为 1-based 行号，并在改动行内渲染词级 `<mark>` 片段；行首缩进留在高亮之外，因为行级 gutter 已经标出了改动。多行替换保持行粒度。可选起始行来自宿主的已应用 hunk，因此调用期 diff 和较早的元数据渲染时没有 gutter，这是预期的回退而非错误。

折叠工具行打印的增删行统计与展开卡片绘制的行，都来自对同一 hunk 的同一遍行比较，因此紧凑行与完整卡片对同一处改动永远不会报出不同的数字。统计基于行：一个 hunk 在两侧都携带的共享行会按其出现的每一侧各计一次，这与卡片绘制的行自洽，但不是 git 的 hunk 头约定。这遵循[客户端推导工具呈现决策](../architecture/2026-08-23-client-derived-tool-presentation.zh.md)，仍属于 Client 呈现：宿主 `FileDiff` 契约、持久化结果元数据和公开组件 props 均未改变，因此回放保持安全，也没有任何线上格式变动。

本分支有意拥有 diff 卡片的源码。升级时把 `packages/client/ui-primitives/src/DiffBlock.tsx`、`packages/client/ui-primitives/src/DiffBlock.module.css`、`packages/client/ui-tool/src/client/tool/models/diff-card-model.ts` 与 `packages/client/ui-primitives/tests/diff-block.client.spec.tsx` 保留在本地一侧，并丢弃官方上下文 diff 测试块，而不是据其重新推导该表面。官方设计是本次变更所拒绝的方案，不是一项尚未应用的改进。

## Alternatives considered

**首尾上限加展开控件。** [卡片原始设计](../../archived/feature/2026-07-30-web-diff-card.md)。经使用后拒绝：它用一个控件和一段隐藏的中间内容，换取滚动视口用来展示真实改动行的同一块屏幕面积，而且在读者打开 diff 正是为了查看改动的场合丢弃了改动内容。

**每侧三行中性上下文，远距离改动拆成独立 hunk。** 官方设计。拒绝：每侧三行会把未改动文本复制进卡片，并在较短的正文里把周围的改动行压到折叠线以下，且每侧成本随 hunk 数量增长。每段未改动内容一行，让改动紧邻其上下文而不把行数花在重复上。

**采纳官方有界编辑距离搜索。** 拒绝：该上限的存在是为了让无上限比较不会卡住折叠摘要，而它在超过上限后回退为整片段的粗粒度替换。真实使用达不到会出问题的规模，而该回退会把整片段行列表塞给正文，从而倒退这个视口。见 Measurement 一节。

**保留官方测试块，让实现去适配它。** 拒绝：该块指定的是本笔记所拒绝的折叠设计，满足它等于重建一个被刻意替换掉的表面，而不是保留本地这个。

## Measurement

本地 Node 探针按片段复现了组件的逐 hunk 推导，片段规模与卡片实际可能收到的输入一致。开发机上的输入与结果：

| 输入 | 单次推导 |
| --- | --- |
| 整文件替换，10000 行 | 18.1 s |
| 交替重复行，10000 行 | 10.3 s |
| `replace_all`，1500 处替换 | 428 ms |
| 稀疏改动，10000 行中的 100 行 | 9.4 ms |

对 339 个已发布 `session.v3.jsonl.zstd` 日志（542752 个 Zstandard 帧、18808 次 `edit` 调用）的扫描测量了每一个编辑参数片段。记录到的最大片段是 316 行；18474 次调用为 1–50 行，283 次为 51–200 行，两次为 201–316 行。没有任何片段接近无上限比较会变慢的规模，因此该上限对此负载毫无收益，而它的粗粒度回退会让视口失去细节。

## Testing

`packages/client/ui-primitives/tests/diff-block.client.spec.tsx` 钉住结构各分支（创建、编辑、同文件 `⋯` 间隔与新路径头、空 diffs 的 null 渲染、行终止符规则、完整删除），并用一个 `DiffBlock viewport and context preview` 块钉住本决策：受上限约束正文的 `max-height`、每段未改动内容一行上下文、视口过短时每个改动行仍可达、分离的第二个 hunk 有自己的上下文行、多行替换保持在一起，以及 `Infinity` 时不设上限的正文。`packages/client/ui-tool/tests/diff-card.client.spec.tsx` 钉住两个渲染位置的推导。单文件覆盖率保持该包要求的水平。

## Consequences

卡片不需要展开状态，因此 diff 除了复制之外没有交互表面。到达远处的改动需要滚动而非点击，这是为"永不隐藏改动"有意付出的代价。gutter 与行内高亮只对携带 `oldStart`/`newStart` 的 hunk 存在，因此调用期 diff 渲染为朴素样式；这种不对称可见但有界。由于统计基于行，一个在两侧都携带共享行的 hunk 会在两侧各报一次该行，这在 `replace_all` 边界之外与 git 的 hunk 头数字不同；要改变这一点需要宿主携带增删统计，而保持紧凑行与卡片一致并不需要它。今后每一次重写上下文 diff 测试块的发布都会重新引入本笔记所解决的这种分裂，因此上面的文件归属是升级中的长期规则，而非一次性清理。

## Related

- [Web diff 卡片](../../archived/feature/2026-07-30-web-diff-card.md) — 本呈现所取代的最初"上限加展开"设计；它当时推迟的行号 gutter 方案正是本卡片现在交付的。
- [Web diff 卡片比较含上下文的内容](2026-09-14-web-diff-context.zh.md) — 官方上下文 diff 决策；其有界比较与粗粒度回退即上面所拒绝的替代方案。
- [客户端推导工具呈现](../architecture/2026-08-23-client-derived-tool-presentation.zh.md) — 本卡片所遵循的归属边界。
