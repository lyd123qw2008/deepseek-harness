# Agent Note: 在程序升级期间保留用户数据

Status: implemented

[English](2026-09-08-upgrade-environment-preserve-and-merge.md) | 中文

## 问题

按版本编写的复制记录没有定义可复用的升级策略。把每次程序升级都当作全新安装，可能丢失 Session、附件、Profile 状态、派生索引、运行时工具或用户 skill；而盲目复制 SQLite 文件可能丢失较新的目标记录和凭据。

## 决定

仓库现在提供 [`dsh-upgrade-environment`](../../../skills/dsh-upgrade-environment/SKILL.md)、[`scripts/upgrade-environment.manifest.json`](../../../../scripts/upgrade-environment.manifest.json) 和 `verify-upgrade-environment`。manifest 区分需要保留的源路径、必须由所属程序合并或重建的 SQLite 状态，以及因 secret 隔离或重新生成而排除的路径。

该 Skill 将代码升级与数据迁移分开。它从精确的 release tag 创建目标 worktree，使用 `git cherry` 区分等价补丁，按源历史顺序使用 `git cherry-pick -x` 应用经过审查的个人提交，并在接触用户数据前验证目标代码。

验证器要求明确的源和目标 home。复制时模式检查选定的字节保留文件与源覆盖范围；迁移后模式允许已记录的 Session、配置和索引重写，同时要求每个源文件及可选目标基线文件仍有对应项。根目录的 `migration-*.json` 和 `sync-*.json` 报告保留在源 home；目标记录自身的升级。它不会复制、删除或打印 secret 值，也不会把历史 `excluded` 数组当作策略。

该 Skill 让源与目标 worktree、数据 home、Profile、凭据和端口保持隔离。未修改的源数据 home 是默认回滚来源；独立源快照、目标升级前备份和回滚演练需要明确请求。它要求为复制的数据库创建一致的 SQLite 快照、不可变的已发布 Session generation、独立的附件和 Engram 检查、冷启动和重启验证。请求目标升级前备份时会启用目标独有状态保留检查。启动后不要求再次复制完整数据。

## 考虑过的替代方案

**复用每个版本的 migration JSON。** 否决，因为这些记录描述已经完成的传输，包含历史排除项，并且没有为未来目标提供可执行检查。

**用递归复制源目录替换目标数据 home。** 否决，因为目标独有状态和较新的 SQLite 记录可能被删除，而且 WAL/SHM 文件不能构成安全的独立数据库快照。

**在 smoke test 后对最终目标做 hash。** 否决，因为启动会在复制时校验点之后合法创建 Session、日志、凭据、索引和生成状态。

## 后果

未来升级共享一个 manifest 和一个只读结构检查，而产品特有的 Session 解码、附件完整性、SQLite 查询、Engram 诊断、Profile 加载和 UI smoke test 仍然是明确的证据。该流程要求升级前的目标备份，并要求新增持久化路径或含 secret 路径时有意更新 manifest。
