import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { importCodexRollouts, parseCodexRollout } from './import-codex-sessions.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? '.', 'dsh-codex-import-'))
  roots.push(root)
  return root
}

function rollout(records: readonly unknown[]): string {
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`
}

const SOURCE_META = {
  timestamp: '2026-03-25T03:11:45.802Z',
  type: 'session_meta',
  payload: {
    id: '019d22fa-0c84-72f1-a4cb-e6e5a5c0ca28',
    timestamp: '2026-03-25T03:11:45.802Z',
    cwd: 'C:\\Users\\liuyd',
    model_provider: 'openai',
  },
}

function completeRollout(): string {
  return rollout([
    SOURCE_META,
    { type: 'response_item', payload: { type: 'image_generation_call' } },
    { timestamp: '2026-03-25T03:12:36.537Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-03-25T03:12:36.537Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-5.4' } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'hidden developer policy' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions\ninternal context' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the project.' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will inspect it.' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"dir"}', call_id: 'call-1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'Exit code: 0\nOutput: ok' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The project is ready.' }] } },
    { timestamp: '2026-03-25T03:15:00.528Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } },
  ])
}

describe('parseCodexRollout', () => {
  it('maps resumable conversation and tool events while skipping Codex-only context', async () => {
    const root = await fixtureRoot()
    const source = join(root, 'rollout.jsonl')
    await writeFile(source, completeRollout())

    const parsed = await parseCodexRollout(source)

    expect(parsed.sourceId).toBe('019d22fa-0c84-72f1-a4cb-e6e5a5c0ca28')
    expect(parsed.cwd).toBe('C:\\Users\\liuyd')
    expect(parsed.stats).toMatchObject({ turns: 1, userMessages: 1, assistantMessages: 3, toolCalls: 1, toolResults: 1 })
    expect(parsed.stats.unsupported).not.toContain('response_item:message:developer')
    expect(parsed.events.map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'user/message', 'assistant/message', 'assistant/message',
      'tool/call', 'tool/result', 'step/end', 'step/start', 'assistant/message', 'step/end', 'turn/end',
    ])
    expect(parsed.events.some(event => event.type === 'request/header')).toBe(false)
    const assistant = parsed.events.find(event => event.type === 'assistant/message')
    expect(assistant?.data.message.source).toMatchObject({ kind: 'model', provider: 'openai', model: 'gpt-5.4' })
    const toolResult = parsed.events.find(event => event.type === 'tool/result')
    expect(toolResult?.data.message.source.kind).toBe('tool')
    const toolAssistant = parsed.events.find(event => event.type === 'assistant/message' && event.data.message.content[0]?.type === 'tool-call')
    expect(toolAssistant?.type).toBe('assistant/message')
    if (toolAssistant?.type === 'assistant/message') {
      expect(toolAssistant.data.message.source).toMatchObject({ kind: 'model', provider: 'openai', model: 'gpt-5.4' })
    }
  })

  it('reports unsupported response items and rejects malformed headers', async () => {
    const root = await fixtureRoot()
    const source = join(root, 'rollout.jsonl')
    await writeFile(source, rollout([
      SOURCE_META,
      { type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'ciphertext' } },
      { type: 'response_item', payload: { type: 'image_generation_call' } },
      { type: 'response_item', payload: { type: 'function_call', name: 'missing-id', arguments: '{}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'missing-id', output: 'orphaned' } },
    ]))
    const parsed = await parseCodexRollout(source)
    expect(parsed.stats.unsupported).toContain('response_item:image_generation_call')
    expect(parsed.stats.unsupported).toContain('response_item:reasoning')
    expect(parsed.stats.unsupported).toContain('malformed tool call')
    expect(parsed.stats.unsupported).toContain('unmatched tool output: missing-id')

    const malformedJson = join(root, 'malformed-json.jsonl')
    await writeFile(malformedJson, '{not-json}\n')
    await expect(parseCodexRollout(malformedJson)).rejects.toThrow('invalid JSON')

    const malformed = join(root, 'malformed.jsonl')
    await writeFile(malformed, rollout([{ type: 'turn_context', payload: {} }]))
    await expect(parseCodexRollout(malformed)).rejects.toThrow('first record is not a valid session_meta')

    const relativeCwd = join(root, 'relative-cwd.jsonl')
    await writeFile(relativeCwd, rollout([{ ...SOURCE_META, payload: { ...SOURCE_META.payload, cwd: 'relative/path' } }]))
    await expect(parseCodexRollout(relativeCwd)).rejects.toThrow('cwd must be absolute')
  })
})

describe('importCodexRollouts', () => {
  it('writes through DSH persistence and skips the same source on repeat', async () => {
    const root = await fixtureRoot()
    const sourceRoot = join(root, 'codex')
    const targetRoot = join(root, 'dsh')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'rollout.jsonl'), completeRollout())

    const first = await importCodexRollouts(sourceRoot, targetRoot)
    expect(first).toMatchObject({ sourceFiles: 1, imported: 1, skippedExisting: 0, failed: 0 })
    expect(first.unsupportedTypes).toMatchObject({ 'response_item:image_generation_call': 1 })
    expect(await readFile(join(sourceRoot, 'rollout.jsonl'), 'utf8')).toBe(completeRollout())
    const second = await importCodexRollouts(sourceRoot, targetRoot)
    expect(second).toMatchObject({ sourceFiles: 1, imported: 0, skippedExisting: 1, failed: 0 })

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: targetRoot, compression: 'zstd' })
    const headers = await ctx.sessionPersistence.list()
    expect(headers.map(header => header.id)).toEqual([SessionId('codex-019d22fa-0c84-72f1-a4cb-e6e5a5c0ca28')])
    const loaded = await ctx.sessionPersistence.inspect(headers[0]!.id)
    expect(loaded.events.some(event => event.type === 'turn/end')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('isolates malformed source files without losing valid imports', async () => {
    const root = await fixtureRoot()
    const sourceRoot = join(root, 'codex')
    const targetRoot = join(root, 'dsh')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'valid.jsonl'), completeRollout())
    await writeFile(join(sourceRoot, 'invalid.jsonl'), '{not-json}\n')

    const report = await importCodexRollouts(sourceRoot, targetRoot)

    expect(report).toMatchObject({ sourceFiles: 2, imported: 1, failed: 1 })
    expect(report.failures[0]?.message).toContain('invalid JSON')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: targetRoot, compression: 'zstd' })
    expect((await ctx.sessionPersistence.list()).map(header => header.id)).toEqual([
      SessionId('codex-019d22fa-0c84-72f1-a4cb-e6e5a5c0ca28'),
    ])
    await ctx.fiber.dispose()
  })

  it('dry-run does not create the target persistence root', async () => {
    const root = await fixtureRoot()
    const sourceRoot = join(root, 'codex')
    const targetRoot = join(root, 'dsh')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(sourceRoot, { recursive: true }))
    await writeFile(join(sourceRoot, 'rollout.jsonl'), completeRollout())

    const report = await importCodexRollouts(sourceRoot, targetRoot, true)

    expect(report.imported).toBe(1)
    await expect(stat(targetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
