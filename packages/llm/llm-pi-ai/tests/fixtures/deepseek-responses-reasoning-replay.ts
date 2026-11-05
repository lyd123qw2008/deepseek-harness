/** Assert DeepSeek Responses reasoning replay during a headless Session run. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { Model } from '@earendil-works/pi-ai'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { toPiContext } from '../../src/context.ts'

export const name = 'deepseek-responses-reasoning-replay-snapshot'
export const inject = ['llm']

const model: Model<'openai-responses'> = {
  id: 'deepseek-flash',
  name: 'DeepSeek Flash',
  api: 'openai-responses',
  provider: 'deepseek',
  baseUrl: 'https://snapshot.invalid/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 300_000,
}

/** Confirm persisted DeepSeek reasoning is rebuilt before the next model call. */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (options, next) => {
    const hasDeepSeekHistory = options.messages.some(message => message.role === 'assistant'
      && message.source.kind === 'model'
      && message.source.provider === 'deepseek')
    if (!hasDeepSeekHistory) return next()

    const input = JSON.parse(JSON.stringify(convertResponsesMessages(
      model,
      normalizeContext(toPiContext(options, undefined, undefined, false, 'durable-text')),
      new Set(['openai', 'openai-codex', 'opencode']),
    ))) as unknown[]
    // The persisted fixture keeps the provider's response-only fields, so an
    // exact match proves replay rebuilds the item instead of echoing it.
    const reasoning = input.find((item): item is Record<string, unknown> => typeof item === 'object'
      && item !== null
      && !Array.isArray(item)
      && (item as Record<string, unknown>)['type'] === 'reasoning')
    assert.deepEqual(reasoning, {
      type: 'reasoning',
      content: [{ type: 'reasoning_text', text: 'check the tool result' }],
    })
    return next()
  })
}
