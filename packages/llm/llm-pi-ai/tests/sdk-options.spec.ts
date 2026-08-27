import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context as PiContext,
  Model,
  ProviderResponse,
  SimpleStreamOptions,
  Usage,
} from '@earendil-works/pi-ai'

const streamSimple = vi.hoisted(() => vi.fn())

function failureMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'local-gateway',
    model: 'local-model',
    usage,
    stopReason: 'error',
    errorMessage: 'mock provider failure',
    timestamp: 0,
    ...overrides,
  }
}

function errorStream(message: AssistantMessage): AsyncIterable<AssistantMessageEvent> {
  return (async function* () {
    yield { type: 'error', reason: 'error', error: message }
  })()
}

// A hand-declared route is built by `createProvider` over the protocol table in
// `src/provider.ts`, so the table's lazy api module is the SDK boundary this
// test can observe. A catalog route dispatches through pi-ai's own provider and
// would not see this mock.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { streamSimple.mockReset() })

/** A hand-declared OpenAI-compatible route with one fully described model. */
function gatewayAdapter(): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles({
      'local-gateway': {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'local-model', contextWindow: 8192, maxTokens: 1024 }],
      },
    }),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function drain(adapter: PiAiAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: 'local-gateway',
    model: 'local-model',
    messages: [],
  })) chunks.push(chunk)
  return chunks
}

describe('pi-ai SDK retry boundary', () => {
  it('pins one SDK attempt even when the installed provider currently defaults to zero retries', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    const chunks = await drain(gatewayAdapter())

    expect(streamSimple).toHaveBeenCalledOnce()
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0, apiKey: 'test-key' })
    // pi-ai reports a setup failure as a terminal in-stream error rather than
    // throwing, which the converter turns into the harness error finish.
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'mock SDK boundary' } },
    })
  })

  it('filters malformed response facts instead of emitting invalid status metadata', async () => {
    const responses: ProviderResponse[] = [
      { status: 99, headers: { 'retry-after-ms': '17', 'x-request-id': 'invalid-low' } },
      { status: 700, headers: { 'retry-after-ms': '19', 'x-request-id': 'invalid-high' } },
    ]
    let responseIndex = 0
    streamSimple.mockImplementation(async (model: Model<Api>, _context: PiContext, options: SimpleStreamOptions) => {
      const response = responses[responseIndex++]
      if (response === undefined) throw new Error('mock response script exhausted')
      void options.onResponse?.(response, model)
      return errorStream(failureMessage())
    })

    const first = await drain(gatewayAdapter())
    const second = await drain(gatewayAdapter())

    for (const chunks of [first, second]) {
      const finish = chunks.at(-1)
      expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
      expect(finish).not.toHaveProperty('reason.failure.status')
      expect(finish).not.toHaveProperty('reason.failure.providerRetryAfterMs')
      expect(finish).not.toHaveProperty('reason.failure.requestId')
    }
  })

  it('preserves terminal status while filling missing response retry facts', async () => {
    let streamIndex = 0
    streamSimple.mockImplementation(async (model: Model<Api>, _context: PiContext, options: SimpleStreamOptions) => {
      void options.onResponse?.({
        status: 503,
        headers: { 'retry-after-ms': '17', 'x-request-id': 'callback-request' },
      }, model)
      const message = streamIndex++ === 0 ? failureMessage({ errorStatus: 429 }) : failureMessage()
      return errorStream(message)
    })

    const chunks = await drain(gatewayAdapter())
    const missingStatus = await drain(gatewayAdapter())

    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          status: 429,
          providerRetryAfterMs: 17,
          requestId: 'callback-request',
        },
      },
    })
    expect(missingStatus.at(-1)).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          status: 503,
          providerRetryAfterMs: 17,
          requestId: 'callback-request',
        },
      },
    })
  })

  it('dispatches a hand-declared route to the endpoint and model its configuration describes', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    await drain(gatewayAdapter())

    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: 'local-model',
      provider: 'local-gateway',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1',
      contextWindow: 8192,
      maxTokens: 1024,
    })
  })
})
