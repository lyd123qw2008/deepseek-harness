# Agent Note: restore Host file opening in web Chat

Status: implemented

English | [中文](2026-09-09-restore-host-file-opening.md)

## Problem

右侧 Sidebar 的文件预览改动替换了 Web Chat 原有的文件动作，因此产出文件 chip 与工具行中的文件路径不再交给操作系统的默认应用。预览界面仍然有用，但不应悄悄替换用户已经依赖的默认动作。

## Decision

Chat 所有的 `openFile` 使用 `resolveWorkspacePath` 相对于 Session 工作区解析路径，然后调用 `ctx.remote.session.openWorkspacePath`。因此路径校验与桌面交接仍由 Host 负责，包括平台文件关联。产出文件 chip、read 行、改写行与通用单文件行都使用这个回调。右侧 Sidebar 仍可通过自己的 Files 文件树与 `dsh-resource://file` 预览路径使用，但不再是 Chat 或 Tool 文件链接的默认目的地。更早的产出文件决定仍负责 chip 词汇与 Host 打开器的理由（[从 Web UI 打开产出文件](../feature/2026-07-31-web-workspace-file-links.zh.md)）。

Chat 与 Tool 的 owner 接口再次只接收路径。行导航选项只服务于产品内文本预览，因此从默认文件链接路径中移除；桌面应用仍可自行决定是否支持打开到某一行。

## Alternatives considered

- **继续让 Sidebar 作为默认目的地：** 否决，因为这会移除既有的操作系统文件关联，使普通文件链接偏离用户已有的桌面工作流。
- **保持 Sidebar 优先并增加第二个原生打开动作：** 否决，因为默认链接仍然是出人意料的行为，而且在恢复直接动作前增加了额外控件。
- **在浏览器中提供所有文件：** 否决，因为这会改变安全与部署边界；现有 Host 打开器已经覆盖本功能面向的本机部署。

## Consequences

文件链接再次通过 Host 的系统默认应用打开，Host 失败仍经由现有 Chat 重试对话框显示。Sidebar 文件树与文本预览仍作为显式的产品内阅读器保留。组装层 UI 测试覆盖 Session 相对路径解析、绝对路径、打开器失败、工具行与嵌套 Code Dispatch 行；Sidebar 测试继续覆盖独立的预览路径。
