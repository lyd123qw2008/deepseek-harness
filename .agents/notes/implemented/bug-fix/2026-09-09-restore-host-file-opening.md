# Agent Note: restore Host file opening in web Chat

Status: implemented

English | [中文](2026-09-09-restore-host-file-opening.zh.md)

## Problem

The right Sidebar file-preview change replaced the web Chat's established file action, so file paths in produced-file chips and Tool rows no longer reached the operating system's default application. The preview surface is useful, but it must not silently replace the default action users already rely on.

## Decision

Chat-owned `openFile` resolves a path against the Session workspace with `resolveWorkspacePath` and calls `ctx.remote.session.openWorkspacePath`. The Host therefore retains path validation and desktop handoff, including platform file associations. Produced-file chips, read rows, mutation rows, and generic single-file rows all use this callback. The right Sidebar remains available through its own Files tree and `dsh-resource://file` preview path; it is not the default destination for Chat or Tool file links. The earlier produced-file decision remains the authority for the chip vocabulary and Host opener rationale ([opening a produced file from the web UI](../feature/2026-07-31-web-workspace-file-links.md)).

The Chat and Tool owner contracts accept only a path again. The line-navigation option was specific to the in-product text preview and is removed from the default file-link path; a desktop application may still choose its own line-opening behavior.

## Alternatives considered

- **Keep the Sidebar as the default:** rejected because it removes the established OS association and makes a normal file link behave differently from the user's existing desktop workflow.
- **Keep Sidebar-first navigation and add a second native action:** rejected for the default link because it preserves the surprising behavior and adds another control before restoring the direct action.
- **Serve every file in the browser:** rejected because it changes the security and deployment boundary; the existing Host opener already supports the local deployment this surface targets.

## Consequences

File links again open through the Host default application, and Host failures remain visible through the existing Chat retry dialog. The Sidebar file tree and text preview remain available as an explicit in-product reader. The assembled UI tests cover Session-relative resolution, absolute paths, opener failures, Tool rows, and nested Code Dispatch rows; the Sidebar tests continue to cover its separate preview path.
