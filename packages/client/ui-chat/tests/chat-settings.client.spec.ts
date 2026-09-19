import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  CHAT_SETTINGS_NAMESPACE, DEFAULT_FILE_OPEN_TARGET, DEFAULT_TRANSCRIPT_VIEW_MODE, apply,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-chat Host settings', () => {
  it('registers, validates, and disposes the transcript-view namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CHAT_SETTINGS_NAMESPACE

    expect(ctx.settings.get(ns)).toEqual({
      transcriptView: DEFAULT_TRANSCRIPT_VIEW_MODE,
      fileOpenTarget: DEFAULT_FILE_OPEN_TARGET,
    })
    await ctx.settings.update(ns, { transcriptView: 'normal', fileOpenTarget: 'sidebar' })
    expect(ctx.settings.get(ns)).toEqual({ transcriptView: 'normal', fileOpenTarget: 'sidebar' })
    await expect(ctx.settings.update(ns, { transcriptView: 'normal', fileOpenTarget: 'dense' })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ apply }).await()).resolves.toBeDefined()
  })
})
