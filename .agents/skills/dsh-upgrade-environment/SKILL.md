---
name: dsh-upgrade-environment
description: Use when upgrading a DeepSeek Harness program while preserving an existing data home, Sessions, attachments, Profiles, settings, derived indexes, runtime tools, user skills, and rollback state across isolated worktrees.
---

# Upgrade a DeepSeek Harness environment

Upgrade the program, not the user's data. Require an explicit source home, target release, target worktree, target data home, and target port before copying anything. Never use a release upgrade as permission to reset, clean, overwrite, or discard an existing environment.

## Read first

Read the repository `AGENTS.md`, [defensive patterns](../../../docs/defensive-patterns.md), and [`scripts/upgrade-environment.manifest.json`](../../../scripts/upgrade-environment.manifest.json). The manifest is the canonical inventory and policy. Historical `migration-*.json` files record past work only; their `excluded` lists are not future migration rules.

## Upgrade the program and pick personal commits

Keep code upgrade and data migration as separate checkpoints. The target code starts from the exact release tag; personal commits are reviewed and applied on top before any data copy.

1. Fetch the release metadata and verify the requested tag. Do not merge current `master` merely to remove a behind count.

   ```sh
   git fetch origin --tags
   git show-ref --verify refs/tags/<target-release-tag>
   git worktree add <target-worktree> -b upgrade/<target-release> <target-release-tag>
   ```

2. Compare the target tag with the personal branch. `git cherry` marks patch-equivalent commits with `-`; only `+` commits need review. Inspect each candidate and keep the source order.

   ```sh
   git merge-base --is-ancestor <source-release-tag> <personal-branch>
   git cherry <target-release-tag> <personal-branch>
   git log --reverse --format='%H %s' <target-release-tag>..<personal-branch>
   git show --stat --summary <personal-commit>
   ```

3. Apply only the reviewed personal commits, oldest first. `-x` records the source commit without changing its author. Apply one logical change at a time so a compatibility conflict stays attributable.

   ```sh
   git cherry-pick -x <personal-commit>
   ```

   Resolve conflicts only in the target worktree. Use `git cherry-pick --continue` after reviewing the result, or `git cherry-pick --abort` to abandon only the current pick. Never use `git reset --hard`, `git clean`, or a whole-tree overwrite to resolve a conflict. If a release API changed, preserve the intent in a new target adaptation commit instead of forcing an obsolete patch through.

4. Keep official release code, personal commits, Profile configuration, and external npm or Pi packages in separate review surfaces. Record source and target commit IDs, skipped patch-equivalent commits, adapted commits, and conflicts in the per-run migration record.
5. Install and validate the target code before touching user data:

   ```sh
   corepack pnpm install --frozen-lockfile
   corepack pnpm run typecheck
   corepack pnpm exec vitest run <focused-test-files>
   ```

   Review `git diff <target-release-tag>...HEAD`, then create the data backup and continue with the migration procedure below. A successful cherry-pick is not proof that the target program understands the source data.

## Required isolation

Keep the source program, target program, source data home, target data home, Profile directory, credentials, and port separate. Refuse an implicit target. Confirm the target release tag or commit before creating its worktree. Stop the target process before copying or replacing SQLite state, and never stop or modify the source process unless the source owner explicitly requests it.

Keep these source paths available when they exist:

- `sessions`
- `attachments`
- `.agent-presets`
- `profiles` configuration, excluding Profile `node_modules`
- `settings.yaml`
- `storages/workspace.json`
- `tools`
- `storages/engram/engram.db` and its SQLite sidecars
- `storages/session-query.sqlite` and its SQLite sidecars
- `storages/session_projcache`
- `storages/lsp`
- `.dsh/skills`

The validator checks source-file coverage and optional target-baseline coverage. It does not replace Session decoders, attachment integrity checks, SQLite queries, Engram diagnostics, or a real startup smoke test.

## Web launcher ownership

The rationale for generated launchers is recorded in [the upgrade launcher Agent Note](../../notes/implemented/process/2026-09-10-upgrade-web-launcher-generation.md). Do not copy or hand-edit versioned Web launcher files. Generate the complete Windows launcher set from the target code home, data home, release, and port:

```sh
corepack pnpm run upgrade-web-launchers --write --data-home <target-home> --code-home <target-worktree> --release <target-release-label> --port <target-port>
```

The command writes and verifies `start-web-<port>.cmd`, `run-web-<port>.ps1`, `stop-web-<port>.cmd`, `restart-web-<port>.ps1`, and `restart-web-<port>.cmd`. Pass the display label without the `dsh-v` tag prefix, such as `0.1.5-alpha.2`. The command never removes files; review and remove only stale versioned Web launchers after the target inventory is known. Run the read-only check before each start or restart and after launcher cleanup:

```sh
corepack pnpm run upgrade-web-launchers --check --data-home <target-home> --code-home <target-worktree> --release <target-release-label> --port <target-port>
```

A launcher check fails when a required file is missing, differs from the target description, or names another port. This keeps launcher paths and the target release in one generated set instead of relying on copied filenames.

## Migration procedure

1. Record the source and target release, worktree, data home, Profile path, port, Node and package-manager versions, and the exact target commit. Create the pre-upgrade source snapshot and target-before backup outside both Git worktrees. Include SQLite files and rollback metadata. These are the only mandatory full data copies; do not create another full target copy after startup. Post-start rollback copies and rollback rehearsals require an explicit request.
2. Run the validator in copy-time mode before application startup:

   ```sh
   corepack pnpm run verify-upgrade-environment --source <source-home> --target <target-home> --target-before <target-backup> --phase copy-time
   ```

   The validator is read-only. It reports missing source files, missing target copies, unexpected exact copies of isolated secrets, and copy-time checksum differences without printing secret values.
3. Copy source-only files and merge common state. Preserve target-only files and newer target state. Do not replace a target SQLite database, WAL, or SHM file as a blind recursive copy. Use the owning application's consistent backup or merge procedure. SQLite sidecars may be checkpointed, rebuilt, or regenerated only after the source records remain covered.
4. Keep released Session generations immutable. Run the product's adjacent Session migration and fail closed on unsupported events. Validate released v0/v1/v2 artifacts, event counts, Zstandard framing, attachment references, and attachment hashes independently of the file validator.
5. Restore Engram from a consistent SQLite snapshot, then run its doctor and project/observation queries. Preserve project names and observations. A healthy SQLite file is not proof that the user's Engram records survived.
6. Reinstall Profile dependencies in the target Profile. Apply only release-specific configuration adaptations after the copy-time audit. Keep `.credentials.yaml`, `.anonymous-user-id`, API keys, bearer tokens, `.env` files, npm tokens, and other machine identity isolated unless the user explicitly authorizes a redacted transfer.
7. Run the launcher check, then start only the target compiled application on the target port. Validate the landing page, authenticated API, Session listing/page/search, long-session pagination, attachments, tool views, child Sessions, settings, and the required user workflow. Record target-generated Sessions and logs after the copy-time checksum point; they are not copy-time losses.
8. Run the validator again after migration and smoke tests:

   ```sh
   corepack pnpm run verify-upgrade-environment --source <source-home> --target <target-home> --target-before <target-backup> --phase post-migration
   ```

   Recheck that every source file remains represented and every pre-upgrade target file remains present. Keep the source home unchanged. Store the report with the migration record, but do not store credentials or full model payloads.

## Rollback

Stop only the target process, preserve the failed target and validator report for diagnosis, and restore the target data home from its pre-upgrade backup. Do not restore by modifying the source home. Re-point the Profile and port to the last known-good program only after checking that its data home and credentials remain isolated.

## Completion criteria

An upgrade is complete only when the target release is explicit, source and target are isolated, the pre-upgrade source snapshot and target-before backup exist, the copy-time and post-migration validator runs pass, source data is unchanged, durable Session and attachment checks pass, SQLite and Engram records are queried successfully, Profile dependencies load, the target starts cold, and the required user workflow survives a restart.
