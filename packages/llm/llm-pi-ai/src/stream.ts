/**
 * pi-ai assistant event translation into the Harness streaming protocol.
 *
 * pi-ai tool-call arguments are parsed objects while the Harness keeps their
 * raw JSON representation. pi-ai also reports failures as terminal stream
 * events, which this module maps into Harness finish chunks.
 *
 * @module dsh-llm-pi-ai/stream
 */

import { ToolCallId, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, isContextWindowExceededError, isQuotaExceededError, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { FinishReason, LlmFailure, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { isContextOverflow } from '@earendil-works/pi-ai'
import type { AssistantMessage, AssistantMessageEvent, Usage as PiUsage } from '@earendil-works/pi-ai'
import { toPiReplayState } from './replay.ts'

/**
 * Map pi-ai usage (reasoning folded into output by pi-ai).
 * @param usage - cumulative usage from the terminal pi-ai event.
 * @returns harness counts with pi-ai's exact total; cache fields appear only
 *   when non-zero (pi-ai reports zeros, not absence).
 */
export function mapUsage(usage: PiUsage): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
  }
}

/**
 * pi-ai 0.84 carries provider diagnostics on AssistantMessage and still flattens
 * several protocol failures into errorMessage. Prefer the structured diagnostic
 * or provider code, then use the narrow text fallback for APIs that expose no
 * usable metadata.
 */
const STRUCTURED_PI_AI_ERROR_CODES: ReadonlyMap<string, string> = new Map([
  ['authentication_error', 'AUTH'],
  ['invalid_api_key', 'AUTH'],
  ['permission_denied', 'AUTH'],
  ['unauthorized', 'AUTH'],
  ['insufficient_quota', QUOTA_EXCEEDED_CODE],
  ['quota_exceeded', QUOTA_EXCEEDED_CODE],
  ['usage_limit_reached', QUOTA_EXCEEDED_CODE],
  ['usage_not_included', QUOTA_EXCEEDED_CODE],
  ['rate_limit_exceeded', 'RATE_LIMIT'],
  ['rate_limit', 'RATE_LIMIT'],
  ['too_many_requests', 'RATE_LIMIT'],
  ['context_length_exceeded', CONTEXT_WINDOW_EXCEEDED_CODE],
  ['context_window_exceeded', CONTEXT_WINDOW_EXCEEDED_CODE],
  ['max_context_length_exceeded', CONTEXT_WINDOW_EXCEEDED_CODE],
  ['request_timeout', 'TIMEOUT'],
  ['timeout', 'TIMEOUT'],
  ['stream_transform_error', 'TRANSPORT'],
  ['stream_error', 'TRANSPORT'],
  ['stream_connection_error', 'TRANSPORT'],
  ['connection_error', 'TRANSPORT'],
  ['connection_reset', 'TRANSPORT'],
  ['network_error', 'TRANSPORT'],
  ['socket_error', 'TRANSPORT'],
  ['econnreset', 'TRANSPORT'],
  ['econnrefused', 'TRANSPORT'],
  ['err_http2_stream_error', 'TRANSPORT'],
  ['websocket_error', 'TRANSPORT'],
  ['websocket_closed', 'TRANSPORT'],
  ['premature_close', 'TRANSPORT'],
  ['provider_transport_failure', 'TRANSPORT'],
  ['server_error', 'SERVER'],
  ['internal_error', 'SERVER'],
  ['service_unavailable', 'SERVER'],
  ['overloaded_error', 'SERVER'],
  ['overloaded', 'SERVER'],
  ['server_is_overloaded', 'PI_AI_ERROR'],
  ['slow_down', 'SERVER'],
  ['model_overloaded', 'SERVER'],
  ['model_busy', 'SERVER'],
  ['invalid_request_error', 'INVALID_REQUEST'],
  ['invalid_prompt', 'INVALID_REQUEST'],
  ['invalid_value', 'INVALID_REQUEST'],
  ['unsupported_value', 'INVALID_REQUEST'],
  ['model_not_found', 'INVALID_REQUEST'],
  ['model_disabled', 'PI_AI_ERROR'],
  ['model_unavailable', 'PI_AI_ERROR'],
])

function validStatus(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
}

function diagnosticFailureCode(message: AssistantMessage): string | undefined {
  const direct = message.errorCode
  if (typeof direct === 'string' && direct.trim().length > 0) return direct
  let transportDiagnostic = false
  for (const diagnostic of message.diagnostics ?? []) {
    const code = diagnostic.error?.code
    if (typeof code === 'string' && code.trim().length > 0) {
      if (STRUCTURED_PI_AI_ERROR_CODES.has(code.trim().toLowerCase())) return code
      transportDiagnostic ||= diagnostic.type === 'provider_transport_failure'
    }
    transportDiagnostic ||= diagnostic.type === 'provider_transport_failure'
  }
  return transportDiagnostic ? 'provider_transport_failure' : undefined
}

function diagnosticFailureStatus(message: AssistantMessage): number | undefined {
  const direct = message.errorStatus
  if (validStatus(direct)) return direct
  for (const diagnostic of message.diagnostics ?? []) {
    const status = diagnostic.details?.status
    if (typeof status === 'number' && validStatus(status)) return status
    const errorStatus = diagnostic.details?.errorStatus
    if (typeof errorStatus === 'number' && validStatus(errorStatus)) return errorStatus
  }
  return undefined
}

/** Preserve explicit non-retryable provider wording before status fallback. */
function terminalPiAiMessageCode(message: string): string | undefined {
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b(?:model|deployment)\b.{0,32}\b(?:disabled|unavailable|not[\s_-]+available|not[\s_-]+enabled|not[\s_-]+found)\b/i.test(message)
    || /\b(?:disabled|unavailable|not[\s_-]+available|not[\s_-]+enabled|not[\s_-]+found)\b.{0,32}\b(?:model|deployment)\b/i.test(message)) {
    return 'PI_AI_ERROR'
  }
  if (/\b(?:billing|payment[\s_-]+required|insufficient[\s_-]+funds|account[\s_-]+balance)\b/i.test(message)) {
    return 'PI_AI_ERROR'
  }
  return undefined
}

function classifyStructuredPiAiError(
  errorCode: string | undefined,
  errorStatus: number | undefined,
  errorMessage: string | undefined,
): string | undefined {
  const normalizedCode = errorCode?.trim().toLowerCase() || undefined
  const structuredCode = normalizedCode === undefined ? undefined : STRUCTURED_PI_AI_ERROR_CODES.get(normalizedCode)
  if (structuredCode !== undefined) return structuredCode
  if (normalizedCode === undefined && errorMessage !== undefined) {
    const terminalCode = terminalPiAiMessageCode(errorMessage)
    if (terminalCode !== undefined) return terminalCode
  }
  if (validStatus(errorStatus)) {
    if (errorStatus === 401 || errorStatus === 403) return 'AUTH'
    if (errorStatus === 408) return 'TIMEOUT'
    if (errorStatus === 429) return 'RATE_LIMIT'
    if (errorStatus >= 500) return 'SERVER'
    if (errorStatus >= 400) return 'INVALID_REQUEST'
  }
  return normalizedCode === undefined ? undefined : 'PI_AI_ERROR'
}

/**
 * Classify pi-ai stream failures whose metadata was flattened into a message.
 *
 * Transport causes are discarded by some upstream adapters before their error
 * events reach the Harness, so legacy protocols still need this narrow fallback.
 */
function classifyFlattenedPiAiError(message: string): string {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  // A rejected request body (gateway or provider size cap): resending the
  // same request cannot succeed, so it is invalid, not transient.
  if (/\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(message)) return 'INVALID_REQUEST'
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\bERR_HTTP2_STREAM_ERROR\b/i.test(message)
    || /stream[_\s-]*transform[_\s-]*error/i.test(message)
    || /\bstream\s+error\b.*\b(?:internal[_\s-]*error|received\s+from\s+peer|stream\s+id)\b/i.test(message)
    || /\b(?:http\/?2|http2)\b.*\b(?:internal[_\s-]*error|received\s+from\s+peer|stream\s+reset|rst[_\s-]*stream)\b/i.test(message)
    || /\b(?:rst[_\s-]*stream|stream\s+reset|peer\s+reset)\b/i.test(message)) return 'TRANSPORT'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  // A stream truncated before the provider's terminal event.
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)
    || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message)
    || /\bterminated\b|premature close/i.test(message)) return 'TRANSPORT'
  return 'PI_AI_ERROR'
}

function failureWithMessage(source: AssistantMessage, code: string, text: string): LlmFailure {
  const directStatus = source.errorStatus
  const status = validStatus(directStatus) ? directStatus : diagnosticFailureStatus(source)
  return {
    message: text,
    code,
    ...validStatus(status) ? { status } : {},
  }
}

/**
 * Map a terminal pi-ai event to the harness finish reason.
 * @param message - the assistant message carried by the `done` or `error` event.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @returns the mapped harness reason. For error events, a preserved provider
 *   code or diagnostic takes precedence over HTTP status and flattened text.
 *   Context-window codes, `stop` usage above `contextWindow`, and zero-output
 *   `length` usage that fills the window map to `CONTEXT_WINDOW_EXCEEDED`; a
 *   `stop` with no content blocks maps to an `EMPTY_RESPONSE` error, while
 *   terminal `pending` and `deferred` states map to non-retryable `PI_AI_ERROR`
 *   failures.
 */
export function mapStopReason(message: AssistantMessage, contextWindow?: number): FinishReason {
  const structuredFailureCode = message.stopReason === 'error'
    ? classifyStructuredPiAiError(
      diagnosticFailureCode(message),
      diagnosticFailureStatus(message),
      message.errorMessage,
    )
    : undefined
  const piAiOverflow = structuredFailureCode === undefined && isContextOverflow(message, contextWindow)
  const harnessOverflow = structuredFailureCode === undefined
    && message.stopReason === 'error'
    && message.errorMessage !== undefined
    && isContextWindowExceededError(message.errorMessage)
  if (piAiOverflow || structuredFailureCode === CONTEXT_WINDOW_EXCEEDED_CODE || harnessOverflow) {
    return {
      kind: 'error',
      failure: failureWithMessage(
        message,
        CONTEXT_WINDOW_EXCEEDED_CODE,
        message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
      ),
    }
  }

  switch (message.stopReason) {
    case 'stop':
      // A terminal stop that produced no content blocks is a degenerate
      // provider completion, not a successful (empty) assistant message.
      if (message.content.length === 0) {
        return {
          kind: 'error',
          failure: {
            message: `model "${message.model}" returned a completed response with no content`,
            code: EMPTY_RESPONSE_CODE,
          },
        }
      }
      return { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'toolUse': return { kind: 'tool-calls' }
    case 'pending': return {
      kind: 'error',
      failure: { message: `pi-ai stream for model "${message.model}" ended pending`, code: 'PI_AI_ERROR' },
    }
    case 'deferred': return {
      kind: 'error',
      failure: { message: `pi-ai deferred response for model "${message.model}" is not supported`, code: 'PI_AI_ERROR' },
    }
    case 'aborted': return {
      kind: 'aborted',
      failure: failureWithMessage(message, 'ABORTED', message.errorMessage ?? 'pi-ai stream aborted'),
    }
    case 'error': {
      const text = message.errorMessage ?? 'pi-ai stream error'
      return {
        kind: 'error',
        failure: failureWithMessage(message, structuredFailureCode ?? classifyFlattenedPiAiError(text), text),
      }
    }
  }
}

/**
 * Translate the pi-ai event stream into StreamChunks. pi-ai never throws
 * mid-stream — failures arrive as `error` events, which become error/aborted
 * `finish` chunks (the harness protocol's other error-delivery style).
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @param callerSignal - caller cancellation state; an aborted caller makes any
 *   in-band terminal error an aborted finish.
 * @returns the harness chunks, ending with `usage` then `finish`; throws
 *   `LlmError` (`STREAM_CLOSED`) if the source ends without a terminal event.
 */
export async function* toStreamChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  contextWindow?: number,
  callerSignal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  // pi-ai contentIndex ↔ our block index map 1:1 (both count blocks from 0
  // in stream order), but we track ids per index for tool calls.
  const toolIds = new Map<number, { id: string; name: string }>()

  for await (const event of events) {
    switch (event.type) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: event.contentIndex, text: event.delta }
        break
      case 'text_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }
        break
      case 'thinking_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }
        break
      case 'thinking_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }
        break
      case 'toolcall_start': {
        // The id/name live on the partial's content at this index.
        const partial = event.partial.content[event.contentIndex]
        const id = partial?.type === 'toolCall' ? partial.id : ''
        const name = partial?.type === 'toolCall' ? partial.name : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: ToolCallId(known?.id ?? ''),
          ...known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {},
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: {
            type: 'tool-call',
            id: ToolCallId(event.toolCall.id),
            name: event.toolCall.name,
            // pi-ai hands back the PARSED arguments; the harness vocabulary
            // keeps the raw string.
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        }
        break
      case 'done':
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(event.message, contextWindow),
          replayState: toPiReplayState(event.message),
        }
        return
      case 'error':
        // In-stream error delivery (pi-ai's style) → error finish chunk
        // (the harness's other sanctioned error path besides throwing).
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(
            callerSignal?.aborted ? { ...event.error, stopReason: 'aborted' } : event.error,
            contextWindow,
          ),
        }
        return
      // no default: AssistantMessageEvent is pi-ai's closed union; a new
      // event type should fail compilation here via tsc's exhaustiveness
      // when one is added (switch covers all current variants).
    }
  }
  throw new LlmError('pi-ai event stream ended without done/error', 'STREAM_CLOSED')
}
