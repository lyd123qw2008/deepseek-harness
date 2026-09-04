# Agent Note: Windows JSONL lease 延迟加载 POSIX 原生模块

Status: implemented

English | [中文](2026-09-04-windows-jsonl-lease-native-loading.md)

## Problem

JSONL lease 模块在模块加载时导入了 `fs-ext`，但 Windows 使用 Win32 信号量实现，从不调用 POSIX `flock(2)`。因此，没有原生构建工具链的 Windows 安装会在 Windows lease 路径运行之前、加载 session-persistence 插件时失败。

## Decision

JSONL lease 在仅用于 POSIX 的 `flockAsync` helper 内加载 `fs-ext`。该包将 `fs-ext` 声明为可选运行时依赖，并保留 `koffi` 作为 Windows 运行时依赖。Windows lease 获取和释放使用现有的命名信号量实现，不解析 POSIX addon。POSIX lease 获取仍需要可用的 `fs-ext` addon；缺少 addon 时，会在首次使用 POSIX lease 时失败。

## Alternatives considered

**保留静态 `fs-ext` 导入，并要求所有平台都有编译器。** 拒绝，因为 Windows 不执行 POSIX 锁实现，不应在受支持的原生路径加载前失败。

**在 Windows 上提供 JavaScript 或 no-op 的 `fs-ext` 替代实现。** 拒绝，因为替代实现要么保留不必要的依赖，要么在错误平台使用时削弱 POSIX 内核锁保证。

**完全移除 POSIX 锁依赖。** 拒绝，因为 POSIX 上的跨进程排他仍然需要 `flock(2)`；本修改仅调整按平台加载的时机。

## Consequences

只要 Win32 路径所需的 `koffi` 可用，即使可选的 `fs-ext` 构建不可用，Windows 部署也能加载 JSONL persistence 插件。POSIX 部署保留现有内核锁，并必须在获取 lease 前安装可用 addon。首次获取 POSIX lease 时会在实际使用位置报告 addon 不可用，而不会让无关的模块加载失败。

JSONL 包 README 记录了按平台区分的原生依赖。Lease 测试、包构建和可选依赖导入检查固定了延迟加载安排。
