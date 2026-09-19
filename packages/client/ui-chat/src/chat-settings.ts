/** Chat transcript preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Field carrying the Chat file-opening target. */
export const FILE_OPEN_TARGET_FIELD = 'fileOpenTarget'

/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Chat file-opening targets accepted at settings boundaries. */
export const FILE_OPEN_TARGETS = ['host', 'sidebar'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Chat file-opening target. */
export type FileOpenTarget = typeof FILE_OPEN_TARGETS[number]

/** Default preserves the compact process disclosure introduced by Chat. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'

/** Default keeps Chat file actions in the Host's default application. */
export const DEFAULT_FILE_OPEN_TARGET: FileOpenTarget = 'host'

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content. */
  transcriptView: TranscriptViewMode
  /** Target used by Chat Markdown links and tool-path actions. */
  fileOpenTarget: FileOpenTarget
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
  [FILE_OPEN_TARGET_FIELD]: z.union([...FILE_OPEN_TARGETS]).default(DEFAULT_FILE_OPEN_TARGET),
})
