/** Import standalone Codex CLI rollout JSONL files into DSH sessions. */

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

/** One parsed JSON object from a Codex rollout. */
export interface CodexRecord {
  readonly timestamp?: string
  readonly type: string
  readonly payload?: unknown
}

/** Statistics and non-fatal compatibility notices for one imported rollout. */
export interface CodexImportStats {
  readonly turns: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly toolResults: number
  readonly unsupported: readonly string[]
}

/** A parsed rollout ready to become one DSH session. */
export interface ParsedCodexRollout {
  readonly sourcePath: string
  readonly sourceId: string
  readonly createdAt: number
  readonly cwd?: string
  readonly events: readonly SessionEvent[]
  readonly stats: CodexImportStats
}

/** Result counters for a batch import. */
export interface CodexImportReport {
  readonly sourceFiles: number
  readonly imported: number
  readonly skippedExisting: number
  readonly skippedEmpty: number
  readonly failed: number
  readonly turns: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly toolResults: number
  readonly unsupported: number
  readonly unsupportedTypes: Readonly<Record<string, number>>
  readonly failures: readonly { path: string; message: string }[]
}

interface JsonObject {
  readonly [key: string]: unknown
}

interface MutableStats {
  turns: number
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  unsupported: string[]
}

interface PendingTool {
  readonly turn: number
  readonly step: number
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function recordPayload(record: CodexRecord): JsonObject | undefined {
  return object(record.payload)
}

function timestampMs(value: unknown, sourcePath: string): number {
  if (typeof value !== 'string') throw new Error(`${sourcePath}: session_meta timestamp must be an ISO timestamp`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${sourcePath}: session_meta timestamp is invalid`)
  return parsed
}

function textFromBlocks(value: unknown, accepted: ReadonlySet<string>): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap((block) => {
    const item = object(block)
    if (item === undefined || !accepted.has(String(item['type']))) return []
    const text = stringValue(item['text'])
    return text === undefined ? [] : [text]
  }).join('')
}

function jsonArguments(value: unknown): string {
  if (typeof value === 'string') return value
  const encoded = JSON.stringify(value)
  return typeof encoded === 'string' ? encoded : ''
}

function internalUserText(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<permissions instructions>')
    || trimmed.startsWith('<collaboration_mode>')
    || trimmed.startsWith('<system-reminder>')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('<turn_aborted>')
    || trimmed.startsWith('<user_instructions>')
}

function unsupported(stats: MutableStats, detail: string): void {
  stats.unsupported.push(detail)
}

function unsupportedCategory(detail: string): string {
  return detail.startsWith('unmatched tool output:') ? 'unmatched tool output' : detail
}

function addUnsupportedCategories(target: Record<string, number>, details: readonly string[]): void {
  for (const detail of details) {
    const category = unsupportedCategory(detail)
    target[category] = (target[category] ?? 0) + 1
  }
}

/** Build one validated DSH event log from Codex records. */
class EventBuilder {
  readonly session: Session
  readonly stats: MutableStats = {
    turns: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    unsupported: [],
  }
  private turn: number | undefined
  private step: number | undefined
  private stepHasModelActivity = false
  private needsNextStep = false
  private readonly pendingTools = new Map<string, PendingTool>()

  constructor(id: SessionId) {
    this.session = Session.create(id)
  }

  startTurn(): void {
    if (this.turn !== undefined) this.endTurn({ kind: 'aborted', reason: { kind: 'legacy' } })
    this.turn = this.stats.turns + 1
    this.stats.turns += 1
    this.step = undefined
    this.stepHasModelActivity = false
    this.needsNextStep = false
    this.session.append('turn/start', { turn: this.turn })
  }

  ensureTurn(): number {
    if (this.turn === undefined) this.startTurn()
    return this.turn as number
  }

  private ensureStep(): { turn: number; step: number } {
    const turn = this.ensureTurn()
    if (this.step === undefined) {
      this.step = 1
      this.session.append('step/start', { turn, step: this.step })
      this.stepHasModelActivity = false
      this.needsNextStep = false
    }
    return { turn, step: this.step }
  }

  private closeStep(): void {
    if (this.turn === undefined || this.step === undefined) return
    this.session.append('step/end', { turn: this.turn, step: this.step })
    this.step = undefined
    this.stepHasModelActivity = false
    this.needsNextStep = false
  }

  addUser(text: string): void {
    if (text.trim() === '' || internalUserText(text)) return
    if (this.stepHasModelActivity || this.needsNextStep) this.closeStep()
    this.ensureStep()
    this.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    this.stats.userMessages += 1
  }

  addAssistant(text: string, provider: string, model: string): void {
    if (text.trim() === '') return
    if (this.needsNextStep) this.closeStep()
    const position = this.ensureStep()
    this.session.append('assistant/message', {
      ...position,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider, model },
      }),
    }, { surfaceOp: 'append' })
    this.stepHasModelActivity = true
    this.stats.assistantMessages += 1
  }

  addToolCall(name: string, callId: string, args: string, provider: string, model: string): void {
    if (name === '' || callId === '') {
      unsupported(this.stats, 'malformed tool call')
      return
    }
    const position = this.ensureStep()
    const id = CallId(callId)
    this.session.append('assistant/message', {
      ...position,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id, name, arguments: args }],
        source: { provider, model },
      }),
    }, { surfaceOp: 'append' })
    this.session.append('tool/call', {
      turn: position.turn,
      step: position.step,
      callId: id,
      name,
      arguments: args,
    })
    this.pendingTools.set(callId, position)
    this.stepHasModelActivity = true
    this.stats.assistantMessages += 1
    this.stats.toolCalls += 1
  }

  addToolResult(callId: string, output: string, isError: boolean): void {
    const position = this.pendingTools.get(callId)
    if (position === undefined || this.turn !== position.turn || this.step !== position.step) {
      unsupported(this.stats, `unmatched tool output: ${callId || '<missing-call-id>'}`)
      return
    }
    this.session.append('tool/result', {
      turn: position.turn,
      step: position.step,
      message: createToolResultMessage({
        callId: CallId(callId),
        content: output === '' ? [] : [{ type: 'text', text: output }],
        isError,
      }),
    }, { surfaceOp: 'append' })
    this.pendingTools.delete(callId)
    this.needsNextStep = true
    this.stats.toolResults += 1
  }

  endTurn(reason: { kind: 'completed' } | { kind: 'aborted'; reason: { kind: 'legacy' } }): void {
    if (this.turn === undefined) return
    this.closeStep()
    this.session.append('turn/end', { turn: this.turn, reason })
    this.turn = undefined
    this.step = undefined
    this.pendingTools.clear()
  }

  finish(): void {
    if (this.turn !== undefined) this.endTurn({ kind: 'aborted', reason: { kind: 'legacy' } })
  }
}

function parseSessionMeta(
  records: readonly CodexRecord[],
  sourcePath: string,
): { id: string; createdAt: number; cwd?: string; provider: string } {
  const first = records[0]
  const payload = first?.type === 'session_meta' ? recordPayload(first) : undefined
  if (payload === undefined) throw new Error(`${sourcePath}: first record is not a valid session_meta`)
  const id = stringValue(payload['id'])
  if (id === undefined || /[\\/:]/u.test(id)) throw new Error(`${sourcePath}: session_meta id is missing or unsafe`)
  const createdAt = timestampMs(payload['timestamp'], sourcePath)
  const cwd = stringValue(payload['cwd'])
  if (cwd !== undefined && !isAbsolute(cwd)) throw new Error(`${sourcePath}: session_meta cwd must be absolute`)
  const provider = stringValue(payload['model_provider']) ?? 'codex'
  return { id, createdAt, ...cwd === undefined ? {} : { cwd }, provider }
}

function parseRecords(source: string, sourcePath: string): CodexRecord[] {
  const records: CodexRecord[] = []
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch (error) {
      throw new Error(`${sourcePath}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    const record = object(value)
    const type = stringValue(record?.['type'])
    if (record === undefined || type === undefined) {
      throw new Error(`${sourcePath}:${index + 1}: record must contain a string type`)
    }
    records.push({
      type,
      ...stringValue(record['timestamp']) === undefined ? {} : { timestamp: record['timestamp'] as string },
      ...record['payload'] === undefined ? {} : { payload: record['payload'] },
    })
  }
  if (records.length === 0) throw new Error(`${sourcePath}: empty rollout`)
  return records
}

/**
 * Parse one Codex rollout file without writing anything.
 * @param sourcePath Absolute path to one Codex JSONL rollout.
 * @returns The validated DSH event log and compatibility statistics.
 */
export async function parseCodexRollout(sourcePath: string): Promise<ParsedCodexRollout> {
  const records = parseRecords(await readFile(sourcePath, 'utf8'), sourcePath)
  const meta = parseSessionMeta(records, sourcePath)
  const builder = new EventBuilder(SessionId(`codex-${meta.id}`))
  let model = 'imported'

  for (const record of records) {
    const payload = recordPayload(record)
    if (record.type === 'event_msg' && payload !== undefined) {
      const eventType = stringValue(payload['type'])
      if (eventType === 'task_started') {
        builder.startTurn()
      } else if (eventType === 'task_complete') {
        builder.endTurn({ kind: 'completed' })
      } else if (eventType === 'turn_aborted') {
        builder.endTurn({ kind: 'aborted', reason: { kind: 'legacy' } })
      } else if (eventType !== undefined && eventType !== 'user_message' && eventType !== 'token_count') {
        unsupported(builder.stats, `event_msg:${eventType}`)
      }
      continue
    }
    if (record.type === 'turn_context') {
      if (payload === undefined) continue
      const contextModel = stringValue(payload['model'])
      if (contextModel !== undefined) model = contextModel
      continue
    }
    if (record.type !== 'response_item' || payload === undefined) continue

    const itemType = stringValue(payload['type'])
    if (itemType === 'message') {
      const role = stringValue(payload['role'])
      const content = payload['content']
      if (role === 'user') {
        builder.addUser(textFromBlocks(content, new Set(['input_text', 'text'])))
      } else if (role === 'assistant') {
        builder.addAssistant(textFromBlocks(content, new Set(['output_text', 'text'])), meta.provider, model)
      } else if (role !== 'developer' && role !== 'system') {
        unsupported(builder.stats, `response_item:message:${role ?? '<missing-role>'}`)
      }
      continue
    }
    if (itemType === 'function_call' || itemType === 'custom_tool_call') {
      const name = stringValue(payload['name']) ?? ''
      const callId = stringValue(payload['call_id']) ?? ''
      const args = jsonArguments(payload['arguments'] ?? payload['input'] ?? {})
      builder.addToolCall(name, callId, args, meta.provider, model)
      continue
    }
    if (itemType === 'function_call_output' || itemType === 'custom_tool_call_output') {
      const callId = stringValue(payload['call_id']) ?? ''
      const output = jsonArguments(payload['output'] ?? payload['result'] ?? '')
      const isError = payload['is_error'] === true || payload['isError'] === true
      builder.addToolResult(callId, output, isError)
      continue
    }
    if (itemType !== 'reasoning') unsupported(builder.stats, `response_item:${itemType ?? '<missing-type>'}`)
    else unsupported(builder.stats, 'response_item:reasoning')
  }

  builder.finish()
  return {
    sourcePath,
    sourceId: meta.id,
    createdAt: meta.createdAt,
    ...meta.cwd === undefined ? {} : { cwd: meta.cwd },
    events: builder.session.events,
    stats: {
      turns: builder.stats.turns,
      userMessages: builder.stats.userMessages,
      assistantMessages: builder.stats.assistantMessages,
      toolCalls: builder.stats.toolCalls,
      toolResults: builder.stats.toolResults,
      unsupported: [...builder.stats.unsupported],
    },
  }
}

async function rolloutFiles(root: string): Promise<string[]> {
  const kind = await stat(root)
  if (kind.isFile()) return [resolve(root)]
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return rolloutFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return nested.flat().sort()
}

function defaultDshHome(): string {
  const configured = process.env['DSH_HOME']
  return configured === undefined || configured.trim() === ''
    ? join(homedir(), '.dsh')
    : resolve(configured)
}

async function withPersistence<T>(targetRoot: string, operation: (ctx: Context) => Promise<T>): Promise<T> {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: targetRoot, compression: 'zstd' })
    return await operation(ctx)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Import Codex rollouts into a DSH JSONL backend.
 * @param sourceRoot File or directory containing Codex JSONL rollouts.
 * @param targetRoot DSH JSONL persistence root.
 * @param dryRun Parse and report without publishing sessions.
 * @returns Counters and explicit compatibility diagnostics for the batch.
 */
export async function importCodexRollouts(sourceRoot: string, targetRoot: string, dryRun = false): Promise<CodexImportReport> {
  const files = await rolloutFiles(sourceRoot)
  const failures: { path: string; message: string }[] = []
  const report = {
    sourceFiles: files.length,
    imported: 0,
    skippedExisting: 0,
    skippedEmpty: 0,
    failed: 0,
    turns: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    unsupported: 0,
    unsupportedTypes: {},
    failures,
  }
  const existing = dryRun
    ? new Set<string>()
    : await withPersistence(targetRoot, async ctx => (
      new Set((await ctx.sessionPersistence.list()).map(header => String(header.id)))
    ))

  for (const path of files) {
    try {
      const parsed = await parseCodexRollout(path)
      report.turns += parsed.stats.turns
      report.userMessages += parsed.stats.userMessages
      report.assistantMessages += parsed.stats.assistantMessages
      report.toolCalls += parsed.stats.toolCalls
      report.toolResults += parsed.stats.toolResults
      report.unsupported += parsed.stats.unsupported.length
      addUnsupportedCategories(report.unsupportedTypes, parsed.stats.unsupported)
      const id = `codex-${parsed.sourceId}`
      if (existing.has(id)) {
        report.skippedExisting += 1
        continue
      }
      if (parsed.stats.userMessages === 0 && parsed.stats.assistantMessages === 0) {
        report.skippedEmpty += 1
        continue
      }
      if (!dryRun) {
        await withPersistence(targetRoot, async (ctx) => {
          const session = ctx.sessions.create(SessionId(id), {
            seed: parsed.events,
            meta: { createdAt: parsed.createdAt, ...parsed.cwd === undefined ? {} : { cwd: parsed.cwd } },
          })
          await ctx.sessions.flush(session)
        })
        existing.add(id)
      }
      report.imported += 1
    } catch (error) {
      report.failed += 1
      failures.push({ path, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return report
}

interface CliOptions {
  source: string
  target: string
  dryRun: boolean
}

function parseArgs(argv: readonly string[]): CliOptions {
  let source = join(homedir(), '.codex', 'sessions')
  let target = join(defaultDshHome(), 'sessions')
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--source') {
      source = argv[++index] ?? (() => { throw new Error('--source needs a path') })()
    } else if (arg === '--target') {
      target = argv[++index] ?? (() => { throw new Error('--target needs a path') })()
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm import:codex-sessions [--source <Codex sessions>] [--target <DSH sessions>] [--dry-run]')
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { source: resolve(source), target: resolve(target), dryRun }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const report = await importCodexRollouts(options.source, options.target, options.dryRun)
  console.log(JSON.stringify(report, null, 2))
}

const entry = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (entry === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
