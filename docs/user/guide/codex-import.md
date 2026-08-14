# Import Codex CLI sessions

English | [中文](codex-import.zh.md)

The source checkout includes a one-time importer for standalone Codex CLI rollout logs. It creates ordinary DSH sessions under the configured JSONL persistence root; the Codex source files remain unchanged.

## Preview and import

Run these commands from the repository root:

```sh
pnpm import:codex-sessions -- --dry-run
pnpm import:codex-sessions
```

The default source is `~/.codex/sessions`. The default target is `$DSH_HOME/sessions`, or `~/.dsh/sessions` when `DSH_HOME` is unset. Use `--source` and `--target` to select different directories.

The dry run parses every rollout, validates its first `session_meta` record and event mapping, and prints counts without creating the target directory. A real import gives each source session the ID `codex-<source-id>`, skips an ID already present in DSH, isolates malformed files, and reports unsupported record categories in its JSON result.

The persistence backend owns publication of each new JSONL artifact. The importer never overwrites an existing DSH session and never writes to the Codex source directory. A failure in one source file does not roll back other successfully imported sessions.

## Continue an imported session

Start or reload the DSH Web UI after the import, refresh the session list, and open an imported session. History loading reads the persisted transcript without starting an Agent; sending the next message cold-resumes the session under the DSH composition selected for that session and uses the current DSH model route.

In the Web UI's **Group by workspace** view, an imported session with no persisted Workspace account is placed in a browser-local group derived from its stored `cwd`; the group displays the directory basename and its hover card exposes the full path. Sessions without `cwd` remain under **Ungrouped**.

The importer preserves user text, assistant `output_text`, recognized function/custom tool calls, tool outputs, workspace, and creation time. It omits Codex developer/system instructions, injected Harness instructions, encrypted reasoning, Codex request headers, and record types that DSH cannot represent. Unsupported records are reported with category counts rather than silently added to the model transcript.

The next request is therefore a DSH continuation, not an exact restart of Codex. The DSH preset supplies the system prompt and tool schemas, and the DSH model selection supplies the provider route. Historical assistant provenance still identifies the source Codex provider and model in the imported transcript.

## Limitations

The importer currently accepts JSONL rollout files and recognizes `session_meta`, `turn_context`, `task_started`, `task_complete`, `turn_aborted`, `message`, `function_call`, `function_call_output`, `custom_tool_call`, and `custom_tool_call_output` records. Images, encrypted reasoning, Codex-specific request state, and other records remain unsupported and appear in the report.

Run the dry run before importing a large history. The importer is a repository command and is not part of the installed `dsh` launcher command grammar.
