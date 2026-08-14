# 导入 Codex CLI 会话

[English](codex-import.md) | 中文

源码仓库提供了一个用于独立 Codex CLI rollout 日志的一次性导入器。它会在配置的 JSONL 持久化根目录下创建普通 DSH 会话，不会修改 Codex 源文件。

## 预览与导入

在仓库根目录运行：

```sh
pnpm import:codex-sessions -- --dry-run
pnpm import:codex-sessions
```

默认源目录是 `~/.codex/sessions`。默认目标目录是 `$DSH_HOME/sessions`；未设置 `DSH_HOME` 时使用 `~/.dsh/sessions`。需要其他目录时使用 `--source` 和 `--target`。

预览会解析每个 rollout，校验首条 `session_meta` 记录和事件映射，并打印统计信息，但不会创建目标目录。实际导入会为每个源会话生成 `codex-<source-id>` ID，跳过 DSH 中已经存在的 ID，隔离损坏文件，并在 JSON 结果中报告不支持的记录类别。

持久化后端负责发布每个新的 JSONL 会话文件。导入器不会覆盖已有 DSH 会话，也不会写入 Codex 源目录；某个源文件失败不会回滚其他已经成功导入的会话。

## 继续使用导入的会话

导入后启动或重新加载 DSH Web UI，刷新会话列表并打开导入的会话。加载历史只读取持久化 transcript，不会启动 Agent；发送下一条消息时，系统会在 DSH 组合下冷恢复该会话，并使用当前 DSH 模型路由。

在 Web UI 的**按工作区**视图中，没有持久化 Workspace 记账但带有 `cwd` 的导入会话会进入按该路径生成的浏览器本地分组；分组显示目录 basename，悬浮卡片显示完整路径。没有 `cwd` 的会话仍位于**未分组**下。

导入器会保留用户文本、assistant 的 `output_text`、可识别的 function/custom tool 调用、工具输出、工作目录和创建时间。它会省略 Codex developer/system 指令、注入的 Harness 指令、加密 reasoning、Codex request header 以及 DSH 无法表达的记录类型。不支持的记录会按类别计数并进入报告，不会静默写入模型 transcript。

下一次请求是 DSH 继续对话，而不是 Codex 的精确重启。DSH preset 提供 system prompt 和工具 schema，DSH 模型选择提供 provider 路由；导入 transcript 中的 assistant provenance 仍会标出原 Codex provider 和模型。

## 限制

导入器当前接受 JSONL rollout 文件，并识别 `session_meta`、`turn_context`、`task_started`、`task_complete`、`turn_aborted`、`message`、`function_call`、`function_call_output`、`custom_tool_call` 和 `custom_tool_call_output` 记录。图片、加密 reasoning、Codex 专用 request state 以及其他记录暂不支持，并会出现在报告中。

导入大量历史前先运行预览。导入器是仓库命令，不属于已安装 `dsh` launcher 的命令语法。
