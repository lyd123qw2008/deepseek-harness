# Agent Note: 本分支独占的 DSH 特性及其升级处理

Status: implemented

[English](2026-09-16-local-exclusive-upgrade-treatment.md) | 中文

## Problem

本 checkout 是一个长期存续的 fork：它跟随上游发布，同时携带自己的行为改动。其中多数改动并非呈现层的微调：每一项都替换了核心包中已发布的行为，而且对已发布的测试套件都不可见，因为随发布提供的测试描述的是上游设计。其中一项是 Client 的适用性规则而非核心行为：取用发布版本会在运行时毫无报错地回退它，只有钉住该规则的本地测试会失败。代码升级会逐文件协调两边，而本地一侧的每个文件都是这样一个位置：取用发布版本会静默回退一个刻意的决定——或者，当发布版本保留了不同的契约时，会留下一个失败的门禁。

这种协调在同一次升级中已经出过两次问题。发布的上下文 diff 测试块落在三个文件里，而第一遍只清理了其中一个，留下了失败的测试（[Web diff 卡片通过滚动视口渲染](../bug-fix/2026-09-15-web-diff-card-scroll-viewport.zh.md)）。又因为 MCP 客户端上的本地 `scope` 键是"允许但未声明"的 schema 键而非被拒绝的键，取用发布的客户端会**在毫无报错的情况下**降级连接模型。逐次查看 diff 无法捕捉这两者：决定及其边界必须一次性记录在一处，这样下一次升级是从清单出发，而不是从 `git diff` 出发。

## Decision

本笔记就是那份清单。它记录升级时必须保留在本地一侧的各项特性、每一项相对上游改变了什么，以及它拥有哪些文件。`dsh-upgrade-environment` 技能在把个人提交与目标 tag 比对时查阅它；每个特性的独立 Agent Note 拥有推理过程，而本笔记拥有清单和归属边界。

这些特性彼此独立，升级必须各自判定；触及其中一项的发布改动对其他项不构成任何说明。

| 特性 | 上游状态 | 本地状态 | 拥有的文件 |
|---|---|---|---|
| Web diff 卡片通过滚动视口 | 用 `structuredPatch` 推导上下文 hunk，每侧三行上下文，折叠配合隐藏行控件，并有有界编辑距离搜索 | 在浏览器端推导行，每段未改动内容一行上下文，正文可滚动，带 1-based 行号 gutter 与词级高亮 | 4 个源码文件、5 个测试文件、2 个 golden |
| Agent Team 能力按 preset 隔离 | 关闭标准委派行并在 profile 层挂载 Team 工具行，因此一个部署要么是标准委派、要么是 Team | 已由用户在 `dsh-v0.2.1-alpha.2` 决定退役；不再保留本地文件 | — |
| MCP 客户端连接作用域 | `transport`、`serverName`、`command`、`url` 与重连调优；每个实例一个子进程，`cwd` 为静态值 | 新增 `scope: 'global' \| 'session-project'`；session-project 池为每个 Session 打开一个子进程，其 `cwd` 即该 Session 的项目 | 4 个文件 |
| bash 会话 cwd 规范化 | 直接使用 Session header 的 `cwd` 作为相对 `workdir` 的基准 | 通过 `canonicalPath` 规范化，使相对 `workdir` 与策略为本次调用加盖的 workspace 根一致 | 1 个源码文件 |
| 完全展开模式平铺对话 | 已由 `dsh-v0.1.7-rc.1` 取代：该版本提供 `verbose`（`foldCompletedTurns: false` 且 `stepGrouping: 'none'`），旧值 `expanded` 读取为 `standard` | 不再保留本地文件；迁移把已保存的 `expanded` 偏好改为 `verbose` | — |

### 由 dsh-v0.1.7-rc.1 取代的偏差

发布版也可能直接实现本地偏差而使其退役。下列每一项都对照已发布实现核实过，不是根据发布说明推断；本地文件及其测试已在同一次提交中删除或替换。

| 已退役偏差 | 发布版替代实现 |
|---|---|
| 完全展开模式平铺对话 | `verbose` 保持 `foldCompletedTurns: false` 与 `stepGrouping: 'none'`，且 `ChatGroupSeat` 由 `stepGrouping` 推导 `grouped`，因此不渲染组头 |
| Office kit 固定 `0.0.2-rc6` 并附 Windows 使用 WASM 的 README 说明 | kit `^0.1.0` 声明 `libreoffice-kit-win32-x64`/`-arm64`，符合平台引擎决策中既有的“按声明的原生引擎”规则 |
| 手写的作者图片路径解析（`localPathMediaUrl` 自行拼 `api/file?path=`） | 共享的 `fileMediaUrl`：校验 POSIX 与 Windows 绝对路径，拒绝 UNC 与控制字符 |
| `path-opener` 中容忍 Explorer 退出码 1 的 `/select,` 调用 | `explorerTarget` 配合 `runExplorer`，并为 Explorer 命令行转义逗号与等号 |

### 由 dsh-v0.1.7-rc.2 取代的偏差

| 已退役偏差 | 发布版替代实现 |
|---|---|
| 从 `tool-bash` 镜像到 `tool-pwsh` 的冗余升权容忍 | 共享的 `approveEscalation` 在请求模式与生效模式相同时直接返回生效模式，两个 shell 因此共用同一份实现 |

### 由 dsh-v0.2.1-alpha.1 取代的偏差

| 已退役偏差 | 发布版替代实现 |
|---|---|
| Terminal 卡片容忍畸形的升权字段 | 发布的 `shellCall` 不再校验升权字段——其注释记录这些字段是否有效取决于只有 Host 知道的 Session 沙箱模式——因此本地的 `allowInvalidEscalation` 参数及其两个用例一并移除。发布的测试用参数化的“Host 接受的升权字段”用例覆盖同一范围 |
| diff 卡片上的 `allowAppliedMetadata` | 发布的 `intendedDiff` 出于同样的理由去掉了 `validEscalationFields` 校验，因此那个只为跳过它而存在的本地旁路随之移除。该文件中真正属于本地的部分——视口高度与可选的 1-based hunk 起始行校验——保留 |

### 由 dsh-v0.2.1-alpha.2 取代的偏差

| 被取代的偏差 | 发布版替代物 |
|---|---|
| `skill-filesystem` 的 Windows watcher 突发恢复 | 本分支合并的原生 `raw` 事件通路已不存在：发布版 watcher 是 chokidar，`WatchHandle` 只有 `{ mode, close() }`，没有 `on('raw')` 可挂载，其配置也已经读 `watchUsePolling` / `watchPollIntervalMs`。突发窗口、`handleNativeRawEvent` 与 `watchNativeBurstWindowMs` 连同固定它们的两个测试文件一并删除 |
| Agent Team 能力按 preset 隔离 | 由用户在 `dsh-v0.2.1-alpha.2` 决定退役，并非发布版提供了替代物。发布版插件在每个成员 scope 安装 Team 工具，preset composition 不再门控；浏览器的 `enabledPresets` 开关与 `agent-team-profile` patch 一并放弃。该特性提供的边界被有意让出：Team-aware preset 不再能对普通会话隐藏 Team 工具。它的测试通过裸 `scope.ctx.plugin(...)` 断言门控，而发布版改用 Loader 的 `mountPreset` 挂载 preset composition，因此在 `dsh-v0.2.1-alpha.2` 上该门控同样没有可验证的路径 |

### Web diff 卡片通过滚动视口

上游从 `structuredPatch` 输出推导显示行，每侧三行上下文，把长正文折在展开控件之后，并在超过有界编辑距离时回退为整片段的粗粒度替换。本分支把 hunk 的每一行渲染进由 `maxHeight` 限制的正文，每段未改动内容只保留一行上下文，并为携带 `oldStart`/`newStart` 的 hunk 加上行号 gutter 与词级高亮。

`oldStart`/`newStart` 契约现在也存在于发布侧：发布版 `computeHunkDiffs` 自身的返回契约就记载了 1 起始的 hunk 起点，因此 `edit.ts` 与 `write.ts` 在发布版 `path: value.path` 结构之外把它们转发进 `presentationMeta`。原样采用发布版调用方会让 `write` 与 `edit` 的结果丢失行号，尽管 hunk 本身携带了它们。

升级冲突是结构性的：发布的上下文 diff 测试块是为上游设计而写并断言它的，因此在本地这个呈现方式下，它会在本分支从未实现的断言上失败。该测试块落在三个文件里，这正是第一遍清理留下失败门禁的原因。

拥有的源码：`packages/client/ui-primitives/src/DiffBlock.tsx`、`packages/client/ui-primitives/src/DiffBlock.module.css`、`packages/client/ui-tool/src/client/tool/models/diff-card-model.ts`，以及宿主侧的 hunk 切片 `packages/fs/tool-fs/src/diff.ts` 与其 `edit`/`write` 调用方。

拥有的测试与 golden：`packages/client/ui-primitives/tests/diff-block.client.spec.tsx`、`packages/client/ui-tool/tests/diff-card.client.spec.tsx`、`packages/client/ui-tool/tests/tool-row.client.spec.tsx`、`apps/web/tests/diff-context.e2e.ts`，以及 `snapshots/web/diff-context` 与 `snapshots/web/diff-bounded`。

不要把本特性的文件与"恢复宿主打开文件"改动（`fix(client): restore host file opening`）混为一谈——后者拥有 `packages/client/ui-tool/src/client/contract/slots.ts`、`packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`、`packages/client/ui-tool/src/client/tool/models/read-card-model.ts` 以及 `read-row`/`read-family-row` 两个 toolview 文件。`ToolRow.tsx` 与 `diff-card-model.ts` 同时靠近两者；而发布的 `tool-row.client.spec.tsx` 中断言折叠编辑统计的那条用例属于本特性，不属于那一项。

### Agent Team 能力按 preset 隔离

已由用户在 `dsh-v0.2.1-alpha.2` 决定退役。该特性曾把标准委派行保留为 one-shot、从 profile 层移除 Team 工具行、把 `@deepseek-ai/dsh-experimental-tool-agent-team` 门控在本插件自身的 composition scope 上，并新增浏览器 `enabledPresets` 开关。现在全部移除：四个 Team 包与发布版逐字节一致，因此 Team 感知的 preset 不再能对普通会话隐藏 Team 工具。

这个决定是在门控失去可验证性之后做出的。它的测试用裸 `scope.ctx.plugin(...)` 挂载来断言该边界，而 `dsh-v0.2.1-alpha.2` 改用 Loader 的 `mountPreset` 挂载 preset composition；在那种挂载下插件从未激活，因此该门控在本版本上也没有得到验证的路径。促成该特性的重叠并未因退役而改变：`tool-subagent-control` 及其 `list-agents` 伴生仍然注册 `list_agents`、`send_message` 与 `interrupt_agent`，正是 Team 插件注册的那三个名字，因此作用域注册表仍可能交给同一个 agent 两个同名工具，而它们的答案来自不同 roster。

若要恢复该边界，应通过发布版的 preset composition 挂载来表达，而不是通过 `createScope` 加直接插件挂载。

### MCP 客户端连接作用域

上游的 stdio 配置把 `cwd` 与 `env` 作为每实例的静态值携带，并以 `cwd: config.cwd` 启动一个子进程。没有任何代码从 Session 推导工作目录，因此官方客户端无法表达"每个 Session 的 MCP 子进程运行在该 Session 的项目里"——这是单份静态配置根本无法表示的形态。

本分支为 stdio 配置新增 `scope`。在 `session-project` 下，它按 Session id 为每个 Session 保留一个连接，并由 `openSession` 用 Session 头部的 `cwd` 覆盖配置中的 `cwd`。这对以进程工作目录为状态键的 MCP server 很重要——`dsh-memory` 及其 Engram server 正是这样解析项目的，因此 Profile 中的 Engram 与 IDEA 两行都依赖它。

协调风险为本特性所独有：`scope` 在发布 schema 中是未声明的键，而未声明的键是被允许而非被拒绝的，因此取用发布的客户端会在没有报错、也没有失败测试的情况下丢掉逐 Session 行为。唯一的证据会是 Engram 给出错误的项目答案。Engram 确实接受 `--project`/`ENGRAM_PROJECT`，但那是进程级的，因此无法替代逐 Session 的绑定。

拥有的文件：`packages/mcp/mcp-client/src/index.ts`、`packages/mcp/mcp-client/src/connection.ts`、`packages/mcp/mcp-client/src/tools.ts` 与 `packages/mcp/mcp-client/tests/apply.spec.ts`。

### Terminal 卡片容忍畸形的升权字段

已由 `dsh-v0.2.1-alpha.1` 取代。上游此前在 Client 侧一律校验可选的升权字段，不区分 Host 是否已经接受：当命令重复请求现行模式时，它携带 `sandbox_permissions` 与空的 `justification`，`isRedundantEscalation` 让 Host 恰好对该配对跳过 `validateEscalationArgs`，而 `validEscalationFields` 仍让 `terminalCardModel` 返回 null，于是这次已经产出输出的调用，其对话行退化为不可点击的标题。

本分支当时通过把 `allowInvalidEscalation` 传入 `shellCall`，在已结算、非错误、且单一结果文本存在的块上保留卡片，而 `diffCardModel` 以 `allowAppliedMetadata` 承载同一容忍。发布版把 Client 侧校验从两个模型中一并移除——`shellCall` 的注释现在记录这些字段是否有效取决于只有 Host 知道的 Session 沙箱模式——因此两处本地旁路都失去了存在理由，并连同钉住它们的两个用例一起移除。发布的测试用参数化的“Host 接受的升权字段”用例保留覆盖，[升权字段配对 Agent Note](../../archived/bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.md) 也随之归档。

## Upgrade checkpoints

对每项特性，升级在三种结果之间选择并记录取了哪一种。**Keep（保留）** 取用本地文件。**Adopt（采纳）** 取用发布文件并退役本地决定，这需要删除或改写钉住它的本地测试，并在同一次改动中更新本清单。**Merge（合并）** 取用发布行为并在其上重新施加本地意图；当上游改动了同一区域但没有替换该概念时，这是预期结果。

以下是"需要重新审视而非默认保留"的信号：

- **Web diff 卡片**：上游引入滚动正文、行号 gutter 或行内高亮，或不再从 `structuredPatch` 上下文推导行。仅上游改动上下文宽度或编辑距离上限则不需要。
- **Agent Team**：已在 `dsh-v0.2.1-alpha.2` 退役；恢复它的信号是出现一种能表达该能力边界的 preset composition 挂载方式，加上 `tool-subagent-control` 与 Team 插件仍在共同声明那三个重叠工具名（`list_agents`、`send_message`、`interrupt_agent`）。
- **MCP 客户端**：上游新增 `scope` 键或任何其他逐 Session 的连接选择。同名键并不自动是同一概念：上游的 `scopeOf(ctx)` 是插件注册作用域，而 `session-project` 是子进程与 Session 项目之间的绑定。
- **Terminal 卡片**：已由 `dsh-v0.2.1-alpha.1` 退役；重新开启它的信号是发布版又在 Client 侧校验升权字段。
- **已退役偏差**：当发布版改变替代实现的契约时，该偏差需重新评估——对 `verbose` 而言，意味着整轮折叠或历史组头分组回归。

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
- [Web diff 卡片比较含上下文的内容](../../archived/bug-fix/2026-09-14-web-diff-context.md) —— 本清单所拒绝的已发布上下文 diff 决策。
- [程序升级期间保留用户数据](2026-09-08-upgrade-environment-preserve-and-merge.zh.md) —— 拥有升级如何隔离、验证与记录。
- [terminal 卡片容忍畸形的升权字段](../../archived/bug-fix/2026-09-21-terminal-card-invalid-escalation-pair.md) —— 本清单在 `dsh-v0.2.1-alpha.1` 中退役的那项历史决定。
