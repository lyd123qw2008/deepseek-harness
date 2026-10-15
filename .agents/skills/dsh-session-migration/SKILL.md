---
name: dsh-session-migration
description: Use when finishing a DeepSeek Harness upgrade by moving the incremental Session data — the generations, attachments, projection cache, and derived indexes the live Session kept writing after the snapshot — into the new data home, and when the new instance must reload those Sessions from disk.
---

# Move incremental Session data into a migrated data home

Finish an environment upgrade with `pnpm run migrate:session-increment`. The [upgrade skill](../dsh-upgrade-environment/SKILL.md) creates the target home from a copy; the Session that served that copy keeps growing in the source home, and a running instance keeps every loaded Session in memory. This skill owns the delta and the restart that makes the new instance serve it.

## Read first

Read the environment manifest [`scripts/upgrade-environment.manifest.json`](../../../scripts/upgrade-environment.manifest.json): it is the path policy this command implements — `sessions` and `attachments` copy exactly, `storages/engram/engram.db` and `storages/session-query.sqlite` come from a consistent online backup, and `storages/session_projcache` is presence-only.

Also read the current upgrade's migration record in the target home. It names the source home, the target home, and the port, and it is the place to append what this run moved.

## Prerequisites

Know three values before running anything: the source home (the one the live Session writes to), the target home, and the target instance's port. Never restart the instance that hosts the Session you are talking through — restart only the target instance, which is the one that has to reload.

## Steps

1. Read the delta without writing. This exits 1 while the target is behind, so it works as a wrap-up gate:

   ```sh
   pnpm run migrate:session-increment -- --source <source-home> --target <target-home> --session <session-id> --check
   ```

2. Sync it. Every Session in the source home is covered unless `--session` narrows the run; `--prune` also mirrors deletions:

   ```sh
   pnpm run migrate:session-increment -- --source <source-home> --target <target-home> [--session <id>…] [--prune]
   ```

3. Refresh the derived indexes when the target's Session list or search must include the new turns. The online backup reads a consistent snapshot while the source instance keeps writing:

   ```sh
   pnpm run migrate:session-increment -- --source <source-home> --target <target-home> --index
   ```

4. Restart the target instance so it reloads its Sessions from disk, and print the new tokenized URL:

   ```sh
   pnpm run migrate:session-increment -- --source <source-home> --target <target-home> --restart <port>
   ```

5. Report the evidence. Each run prints the per-generation frame and event counts, whether every generation ended byte-identical, the attachment counts, the index sizes, and the restarted URL. Open the new URL and confirm the newest turn renders before calling the migration done.

## What it guarantees

`--check` compares byte hashes and decodes every generation through the product's own `scanZstdFrames` and frame decoder, so a torn or truncated copy is visible rather than silently accepted. A syncing run copies by size and mtime, verifies, and retries once because the source home is live. The command never writes to the source home.

## Gotchas

- A running instance keeps loaded Sessions in memory. Replacing the log files underneath it changes nothing until the process restarts, which is why a sync that must be visible ends with `--restart`.
- An agent shell starts without the User-scope provider keys, so the restart re-injects them from the User scope. It must not copy `Path`, `TEMP`, `TMP`, or `JAVA_HOME`: overwriting `Path` with the User-scope value alone leaves the child unable to resolve `node`.
- The source home stays live, so a turn may be in flight at copy time and the last turn can render as interrupted on the target. Re-run the sync after the turn settles for a clean handoff.
- Both homes then hold the same Session id. Only one side should keep the conversation: each instance appends to its own home, so continuing on both makes the two logs diverge.
- A release can retire the value the old home stored for a preference (`expanded` became a legacy value when `verbose` arrived). Move that preference while migrating the Profile, and record the mapping in the migration record.
