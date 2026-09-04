# Agent Note: Windows JSONL leases defer POSIX native loading

Status: implemented

English | [中文](2026-09-04-windows-jsonl-lease-native-loading.zh.md)

## Problem

The JSONL lease module imported `fs-ext` while the module loaded, although Windows uses the Win32 semaphore implementation and never calls POSIX `flock(2)`. A Windows installation without a native build toolchain therefore failed while loading the session-persistence plugin before the Windows lease path could run.

## Decision

The JSONL lease loads `fs-ext` inside the POSIX-only `flockAsync` helper. The package declares `fs-ext` as an optional runtime dependency and keeps `koffi` as the Windows runtime dependency. Windows lease acquisition and release use the existing named semaphore implementation without resolving the POSIX addon. POSIX lease acquisition still requires a working `fs-ext` addon, and a missing addon fails when the POSIX lease is first used.

## Alternatives considered

**Keep a static `fs-ext` import and require a compiler on every platform.** Rejected because Windows does not execute the POSIX lock implementation and should not fail before its supported native path loads.

**Provide a JavaScript or no-op `fs-ext` replacement on Windows.** Rejected because a replacement would either preserve an unnecessary dependency or weaken the POSIX kernel-lock guarantee if it were used on the wrong platform.

**Remove the POSIX lock dependency entirely.** Rejected because cross-process exclusion on POSIX still requires `flock(2)`; the change is limited to platform-specific loading.

## Consequences

Windows deployments can load the JSONL persistence plugin when the optional `fs-ext` build is unavailable, provided `koffi` is available for the Win32 path. POSIX deployments retain the existing kernel lock and must install a usable addon before acquiring a lease. The first POSIX lease acquisition reports an unavailable addon at its actual use site instead of making unrelated module loading fail.

The JSONL package README documents the platform-specific native dependency. Lease tests, the package build, and the optional-dependency import check pin the deferred-loading arrangement.
