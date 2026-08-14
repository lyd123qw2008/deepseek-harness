# Agent Note: Codex preset 通过 Codex 原生搜索执行网络检索

Status: implemented

[English](2026-08-14-codex-preset-native-web-search.md) | 中文

## 问题

Web profile 默认的 `tool-web` 暴露 `web_search`，其随附提供方会通过 DeepSeek 执行网络检索。已经配置官方 Codex CLI 身份验证的部署需要一个能把检索委托给 Codex 自己的 websearch、又不同时暴露两条竞争性搜索路径的 preset。

## 决策

随附的 `codex` preset 位于 `apps/cli/config/agent-presets/codex`。它保留标准编码能力，启用 `subagent_codex` 工具，省略面向模型的 `tool-web` 行，并在 persona 中指示模型把网络检索交给 Codex。Web 组合包显式依赖 `@deepseek-ai/dsh-subagent-codex`，并在 host 上挂载休眠的 `codex` 提供方；只有该 preset 的工具被调用时，提供方才会启动原生进程。根据[生产 dsh 排除产品 subagent 提供方](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md)，base 组合包仍不包含产品提供方依赖和配置行。

## 验证

Web 组合 e2e 通过真实 Loader 列出随附 preset，观察 host 上的 `codex` 提供方，挂载该 preset，并断言其面向模型的目录包含 `subagent_codex` 而不包含 `web_search`。同一测试还检查 preset persona 中的原生搜索指令；Codex 提供方已有的 Loader 与产品测试覆盖无进程启动的加载路径和官方 app-server 生命周期。

## 考虑过的替代方案

**在新 preset 中保留 DSH 的 `web_search`。** 这样会让该 preset 的网络检索继续走 DeepSeek 提供方，而不是用户要求的 Codex 原生能力；如果同时暴露 Codex 委托，还会给模型两条竞争性的检索路径。

**把 Codex 提供方放进 `dsh-base`。** 这样会让每次生产安装都带上可选的产品集成。Web 组合包是这个随附 preset 的显式 Profile 所有者，因此 base 依赖排除规则保持有效。

**把委托工具重命名为 `web_search`。** 共享委托 schema 接收自包含任务，而不是搜索查询，并且暴露的是提供方生命周期语义。保留 `subagent_codex` 能明确标识原生产品路径，避免通用搜索 schema 声称 Codex 提供方并不拥有的保证。

## 后果

Web 安装会包含 Codex 提供方包，并在 GUI 中提供原生搜索 preset；普通 preset 继续使用 DSH 的 DeepSeek `web_search` 路径。选择 `codex` 需要官方 `codex` 命令及其原生身份验证；加载 Web profile 不会启动该命令。网络检索会额外消耗一次 Codex 轮次，并通过现有 subagent 结果约定返回。
