# Agent Note: 本分支独占的 DSH 特性及其升级处理

Status: implemented

[English](2026-09-16-local-exclusive-upgrade-treatment.md) | 中文

## Problem

本 checkout 是一个长期存续的 fork：它跟随上游发布，同时携带自己的行为改动。其中三项改动并非呈现层的微调：每一项都替换了核心包中已发布的行为，而且对已发布的测试套件都不可见，因为随发布提供的测试描述的是上游设计。第四项是 Client 的适用性规则而非核心行为：取用发布版本会在运行时毫无报错地回退它，只有钉住该规则的本地测试会失败。代码升级会逐文件协调两边，而本地一侧的每个文件都是这样一个位置：取用发布版本会静默回退一个刻意的决定——或者，当发布版本保留了不同的契约时，会留下一个失败的门禁。

这种协调在同一次升级中已经出过两次问题。发布的上下文 diff 测试块落在三个文件里，而第一遍只清理了其中一个，留下了失败的测试（[Web diff 卡片通过滚动视口渲染](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.zh.md)）。又因为 MCP 客户端上的本地 `scope` 键是"允许但未声明"的 schema 键而非被拒绝的键，取用发布的客户端会**在毫无报错的情况下**降级连接模型。逐次查看 diff 无法捕捉这两者：决定及其边界必须一次性记录在一处，这样下一次升级是从清单出发，而不是从 `git diff` 出发。

## Decision

本笔记就是那份清单。它记录升级时必须保留在本地一侧的四项特性、每一项相对上游改变了什么，以及它拥有哪些文件。`dsh-upgrade-environment` 技能在把个人提交与目标 tag 比对时查阅它；每个特性的独立 Agent Note 拥有推理过程，而本笔记拥有清单和归属边界。

这四项特性彼此独立，升级必须各自判定；触及其中一项的发布改动对其他三项不构成任何说明。

| 特性 | 上游状态 | 本地状态 | 拥有的文件 |
|---|---|---|---|
| Web diff 卡片通过滚动视口 | 用 `structuredPatch` 推导上下文 hunk，每侧三行上下文，折叠配合隐藏行控件，并有有界编辑距离搜索 | 在浏览器端推导行，每段未改动内容一行上下文，正文可滚动，带 1-based 行号 gutter 与词级高亮 | 4 个源码文件、5 个测试文件、2 个 golden |
| Agent Team 能力按 preset 隔离 | 关闭标准委派行并在 profile 层挂载 Team 工具行，因此一个部署要么是标准委派、要么是 Team | 保留标准委派行并置为 one-shot，只在插件自身的 composition scope 内安装 Team 工具，并在 UI 层按 preset id 门控 | 4 个包、11 个文件 |
| MCP 客户端连接作用域 | `transport`、`serverName`、`command`、`url` 与重连调优；每个实例一个子进程，`cwd` 为静态值 | 新增 `scope: 'global' \| 'session-project'`；session-project 池为每个 Session 打开一个子进程，其 `cwd` 即该 Session 的项目 | 4 个文件 |
| Terminal 卡片容忍畸形的升权字段 | 只要存在 `sandbox_permissions` 就要求 `justification` 非空，因此 Host 以冗余为由接受的字段配对仍会隐藏 terminal 卡片 | 已结算且成功的调用只要结果文本存在就保留卡片；其余畸形字段状态仍走通用路径 | 1 个源码文件、1 个测试文件 |

### Web diff 卡片通过滚动视口

上游从 `structuredPatch` 输出推导显示行，每侧三行上下文，把长正文折在展开控件之后，并在超过有界编辑距离时回退为整片段的粗粒度替换。本分支把 hunk 的每一行渲染进由 `maxHeight` 限制的正文，每段未改动内容只保留一行上下文，并为携带 `oldStart`/`newStart` 的 hunk 加上行号 gutter 与词级高亮。

升级冲突是结构性的：发布的上下文 diff 测试块是为上游设计而写并断言它的，因此在本地这个呈现方式下，它会在本分支从未实现的断言上失败。该测试块落在三个文件里，这正是第一遍清理留下失败门禁的原因。

拥有的源码：`packages/client/ui-primitives/src/DiffBlock.tsx`、`packages/client/ui-primitives/src/DiffBlock.module.css`、`packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`，以及宿主侧的 hunk 切片 `packages/fs/tool-fs/src/diff.ts` 与其 `edit`/`write` 调用方。

拥有的测试与 golden：`packages/client/ui-primitives/tests/diff-block.client.spec.tsx`、`packages/client/ui-tool/tests/diff-card.client.spec.tsx`、`packages/client/ui-tool/tests/tool-row.client.spec.tsx`、`apps/web/tests/diff-context.e2e.ts`，以及 `snapshots/web/diff-context` 与 `snapshots/web/diff-bounded`。

不要把本特性的文件与"恢复宿主打开文件"改动（`fix(client): restore host file opening`）混为一谈——后者拥有 `packages/client/ui-tool/src/client/contract/slots.ts`、`packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`、`packages/client/ui-tool/src/client/tool/models/read-card-model.ts` 以及 `read-row`/`read-family-row` 两个 toolview 文件。`ToolRow.tsx` 与 `diff-card-model.ts` 同时靠近两者；而发布的 `tool-row.client.spec.tsx` 中断言折叠编辑统计的那条用例属于本特性，不属于那一项。

### Agent Team 能力按 preset 隔离

上游的 Agent Teams profile 层直接关闭 `tool-subagent` 与 `tool-subagent-fork`，以便把"直接委派与协调"移交给 Team 工具，并在该层挂载 Team 工具行。这使该层成为一个部署级的选择：挂载它会在所有地方移除标准委派，而 Team UI bundle 全局挂载、没有 preset 门控，因此普通会话也会多出一个 Team 入口。

本分支把标准委派行保留为 one-shot（`backgroundMode: one-shot`）并从 profile 层移除 Team 工具行。随后 `@deepseek-ai/dsh-experimental-tool-agent-team` 只为其 scope 链包含本插件自身 composition scope 的 agent 安装工具，于是 Team 感知的 preset 成为能力边界，而 Team 服务仍归宿主所有。浏览器侧新增 `enabledPresets`，对其他 preset 不渲染任何内容，同时保持插槽挂载以维持稳定注册与 HMR。

这种重叠并非假设：`tool-subagent-control` 及其 `list-agents` 伴生注册了 `list_agents`、`send_message` 与 `interrupt_agent`，正是 Team 插件注册的那三个名字。作用域注册表只在同一个 scope 内拒绝重名，因此两层都能干净挂载，并交给同一个 agent 两个同名工具，而它们的答案来自不同的 roster——这是静默，不是报错。这就是两层必须保持镜像的原因。

拥有的文件：`packages/experimental/agent-team-profile/cordis.patch.yml` 及其 profile 测试、`packages/experimental/tool-agent-team/src/index.ts` 及其测试，以及 `packages/experimental/client-ui-agent-team`（其 `Config`、`TeamAction.tsx`、`mount.ts`、`index.ts` 与两个客户端测试）。该能力只占改动的一半：选择加入的 preset 位于数据 home 的 `.agent-presets/team-local` 与 `.agent-presets/team-pragmatic-local`，它们自己挂载 `tool-agent-team`。一个保留了 preset 却丢失本补丁的 Profile，会让那些 preset 请求一个该层不再提供的能力。

### MCP 客户端连接作用域

上游的 stdio 配置把 `cwd` 与 `env` 作为每实例的静态值携带，并以 `cwd: config.cwd` 启动一个子进程。没有任何代码从 Session 推导工作目录，因此官方客户端无法表达"每个 Session 的 MCP 子进程运行在该 Session 的项目里"——这是单份静态配置根本无法表示的形态。

本分支为 stdio 配置新增 `scope`。在 `session-project` 下，它按 Session id 为每个 Session 保留一个连接，并由 `openSession` 用 Session 头部的 `cwd` 覆盖配置中的 `cwd`。这对以进程工作目录为状态键的 MCP server 很重要——`dsh-memory` 及其 Engram server 正是这样解析项目的，因此 Profile 中的 Engram 与 IDEA 两行都依赖它。

协调风险为本特性所独有：`scope` 在发布 schema 中是未声明的键，而未声明的键是被允许而非被拒绝的，因此取用发布的客户端会在没有报错、也没有失败测试的情况下丢掉逐 Session 行为。唯一的证据会是 Engram 给出错误的项目答案。Engram 确实接受 `--project`/`ENGRAM_PROJECT`，但那是进程级的，因此无法替代逐 Session 的绑定。

拥有的文件：`packages/mcp/mcp-client/src/index.ts`、`packages/mcp/mcp-client/src/connection.ts`、`packages/mcp/mcp-client/src/tools.ts` 与 `packages/mcp/mcp-client/tests/apply.spec.ts`。

### Terminal 卡片容忍畸形的升权字段

上游在 Client 侧一律校验可选的升权字段，不区分 Host 是否已经接受。当命令重复请求现行模式时，它携带 `sandbox_permissions` 与空的 `justification`；`isRedundantEscalation` 让 Host 恰好对该配对跳过 `validateEscalationArgs`，于是调用照常执行并结算，而 Client 没有冗余概念，`validEscalationFields` 使 `terminalCardModel` 返回 null。结果是一次已经产出输出的调用，其对话行退化为不可点击的标题加摘要；而模型省略这对字段时，同一工具的行仍可展开。

本分支在调用本身已证明执行过时保留卡片：已结算、非错误、且单一结果文本存在的块把 `allowInvalidEscalation` 传入 `shellCall`，仅该次调用跳过配对校验。运行中、出错、后台、持久 shell 与 spill 预览的调用仍走通用路径，`timeoutMs`、`workdir`、`run_in_background` 保持原有校验。该规则复制了 `diffCardModel` 通过 `allowAppliedMetadata` 已授予成功变更的容忍。

拥有的源文件：`packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts`。

拥有的测试：`packages/client/ui-tool/tests/terminal-card.client.spec.tsx`，它同时承载本分支新增的两个用例与发布版本能满足的畸形字段测试表。

与上面三项不同，取用发布版本会让该测试失败，而不是静默降级，因此它的升级风险是一个失败门禁，而非无声回退。[升权字段配对 Agent Note](../bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.zh.md)负责其论证。

## Upgrade checkpoints

对每项特性，升级在三种结果之间选择并记录取了哪一种。**Keep（保留）** 取用本地文件。**Adopt（采纳）** 取用发布文件并退役本地决定，这需要删除或改写钉住它的本地测试，并在同一次改动中更新本清单。**Merge（合并）** 取用发布行为并在其上重新施加本地意图；当上游改动了同一区域但没有替换该概念时，这是预期结果。

以下是"需要重新审视而非默认保留"的信号：

- **Web diff 卡片**：上游引入滚动正文、行号 gutter 或行内高亮，或不再从 `structuredPatch` 上下文推导行。仅上游改动上下文宽度或编辑距离上限则不需要。
- **Agent Team**：上游改变 Team 工具行的挂载方式、`apply(ctx, config)` 签名、`mountAgentTeamUi` 的参数个数，或 Team 与 subagent-control 同时声明的工具名。
- **MCP 客户端**：上游新增 `scope` 键或任何其他逐 Session 的连接选择。同名键并不自动是同一概念：上游的 `scopeOf(ctx)` 是插件注册作用域，而 `session-project` 是子进程与 Session 项目之间的绑定。
- **Terminal 卡片**：上游让已成功结算的 shell 卡片在可选升权配对失败时仍然保留、改变 `terminalCardModel` 的适用性签名，或在 Client 侧引入冗余概念。重新采纳严格校验也意味着改写钉住该容忍的两个本地用例。

发布的测试文件不能证明本地行为是错的。当发布的测试钉住的是本清单所拒绝的设计时，本地一侧同样拥有该测试文件。

## Alternatives considered

**在仓库之外维护一份清单。** 拒绝：升级工作流读取的是仓库，而聊天或技能文件里的清单会在任一侧移动的瞬间与代码脱节。Agent Note 与它所命名的文件一同版本化，并受文档门禁检查。

**只让各特性的独立 Agent Note 承载清单。** 拒绝：这些条目彼此独立，而它们的笔记描述的是设计而非归属边界。升级需要一处来回答"发布的改动会与哪些文件冲突"，而这个答案与任何单份设计笔记都不同形。

**只记录易冲突的文件。** 拒绝：MCP 作用域特性根本不产生冲突——它是静默降级的——因此一份以冲突为键的清单会漏掉最需要警告的那一项。

**采纳上游并放弃本地特性。** 拒绝：每项特性的存在都是因为上游行为在使用中被验证并拒绝，而每一处替换都会让本部署失去一个所依赖的能力（逐 Session 的 MCP 项目绑定、与 Team 并存的标准委派，以及该 diff 呈现方式）。退役其中任何一项都是刻意的决定，而非升级的副作用。

## Consequences

升级在协调之前先读本笔记，并且每项特性的结果是被记录下来的，而不是被重新发现。代价是四个上游区域无法原样取用，因此大幅重写其中之一的发布会变成一次合并而非一次检出；上面的检查点通过指明必须重新判定的内容来把这个合并限制在范围内。

这里的每一条都是"更愿意向上游贡献而非携带 fork"的理由：MCP 连接作用域与按 preset 的 Team 边界是通用需求而非本地偏好，一份已发布的实现会同时免除该补丁与本清单。diff 卡片是真正的本地偏好，而升权容忍是一项同样属于上游的 Client 严格性修复。

## Related

- [Web diff 卡片通过滚动视口渲染](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.zh.md) —— 拥有 diff 卡片的决定、其度量，以及它所拒绝的替代方案。
- [Web diff 卡片比较含上下文的内容](../bug-fix/2026-09-14-web-diff-context.zh.md) —— 本清单所拒绝的已发布上下文 diff 决策。
- [程序升级期间保留用户数据](2026-09-08-upgrade-environment-preserve-and-merge.zh.md) —— 拥有升级如何隔离、验证与记录。
- [terminal 卡片容忍畸形的升权字段](../bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.zh.md) —— 拥有本清单必须重新判定的 Client 适用性改动。
