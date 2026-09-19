// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSettings } from '../src/chat-settings.ts'
import { FileOpenTargetPolicy } from '../src/client/file-open-target.ts'

describe('FileOpenTargetPolicy', () => {
  it('defaults to the Host application and persists explicit Sidebar choices', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new FileOpenTargetPolicy(host.scope)

    expect(policy.target.getSnapshot()).toBe('host')
    policy.setTarget('sidebar')
    expect(policy.target.getSnapshot()).toBe('sidebar')
    expect(host.set).toHaveBeenCalledWith('fileOpenTarget', 'sidebar')
  })

  it('adopts Host state and ignores identical writes', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new FileOpenTargetPolicy(host.scope)

    host.publish({
      status: 'ready',
      value: { transcriptView: 'compact', fileOpenTarget: 'sidebar' },
      revision: 1,
      writable: true,
    })
    expect(policy.target.getSnapshot()).toBe('sidebar')
    policy.setTarget('sidebar')
    expect(host.set).not.toHaveBeenCalled()

    host.publish({ value: { transcriptView: 'compact', fileOpenTarget: 'host' }, revision: 2 })
    expect(policy.target.getSnapshot()).toBe('host')
  })
})
