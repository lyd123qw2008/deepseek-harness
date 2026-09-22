// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSettings } from '../src/chat-settings.ts'
import { FileOpenTargetPolicy } from '../src/client/file-open-target.ts'

describe('FileOpenTargetPolicy', () => {
  it('defaults to the Host application and publishes explicit choices before persistence settles', () => {
    const host = stubConfigForm<ChatSettings>()
    const observed: string[] = []
    let current = (): string => 'unconstructed'
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${current()}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new FileOpenTargetPolicy(scope)
    current = () => policy.target.getSnapshot()

    expect(policy.target.getSnapshot()).toBe('host')
    policy.setTarget('sidebar')
    expect(policy.target.getSnapshot()).toBe('sidebar')
    expect(observed).toEqual(['fileOpenTarget=sidebar:sidebar'])
    expect(host.set).toHaveBeenCalledWith('fileOpenTarget', 'sidebar')
  })

  it('adopts Host state and ignores identical writes', () => {
    const host = stubConfigForm<ChatSettings>()
    const policy = new FileOpenTargetPolicy(host.scope)

    host.publish({
      status: 'ready',
      value: { linkOpening: 'sidebar', transcriptView: 'compact', performanceUsage: 'detailed', fileOpenTarget: 'sidebar' },
      revision: 1,
      writable: true,
    })
    expect(policy.target.getSnapshot()).toBe('sidebar')
    policy.setTarget('sidebar')
    expect(host.set).not.toHaveBeenCalled()

    host.publish({
      value: { linkOpening: 'sidebar', transcriptView: 'compact', performanceUsage: 'detailed', fileOpenTarget: 'host' },
      revision: 2,
    })
    expect(policy.target.getSnapshot()).toBe('host')
  })

  it('adopts an accepted section standing at construction', () => {
    const host = stubConfigForm<ChatSettings>()
    host.publish({
      status: 'ready',
      value: { linkOpening: 'sidebar', transcriptView: 'compact', performanceUsage: 'detailed', fileOpenTarget: 'sidebar' },
      revision: 1,
      writable: true,
    })
    expect(new FileOpenTargetPolicy(host.scope).target.getSnapshot()).toBe('sidebar')
  })
})

it('releases its subscription when the consuming plugin unloads', () => {
  const host = stubConfigForm<ChatSettings>()
  const policy = new FileOpenTargetPolicy(host.scope)
  expect(host.listenerCount()).toBe(1)
  policy.dispose()
  expect(host.listenerCount()).toBe(0)
})
