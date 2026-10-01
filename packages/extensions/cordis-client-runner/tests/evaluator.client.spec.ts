/**
 * @vitest-environment jsdom
 *
 * Closure evaluation account: the symbol surface a browser half receives, the
 * teaching traps shadowing ambient globals, the parse/return diagnostics, and
 * the style bookkeeping whose disposal the runner owns.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CordisDynamicPluginId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  DynamicCordisStyles,
  DYNAMIC_CLIENT_REDIRECTS,
  evaluateClientHalf,
  isDynamicCordisPlugin,
} from '../src/client/evaluator.ts'
import type { DynamicCordisClosureEnv, DynamicCordisEvaluatedPlugin } from '../src/client/evaluator.ts'

const ID = 'dyn-1' as CordisDynamicPluginId
const scripts = new Map<string, Blob>()
const createdBlobs: Blob[] = []
const revokedUrls: string[] = []
let scriptSequence = 0
let allocationFailure: Error | undefined
let appendFailure: Error | undefined
let loadFailure = false

beforeEach(() => {
  scripts.clear()
  createdBlobs.length = 0
  revokedUrls.length = 0
  scriptSequence = 0
  allocationFailure = undefined
  appendFailure = undefined
  loadFailure = false
  const appendChild = document.head.appendChild.bind(document.head)
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    if (allocationFailure !== undefined) throw allocationFailure
    if (!(blob instanceof Blob)) throw new TypeError('Expected client script Blob')
    const url = `blob:http://localhost/dsh-test-${++scriptSequence}`
    scripts.set(url, blob)
    createdBlobs.push(blob)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revokedUrls.push(url)
    scripts.delete(url)
  })
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const script = node instanceof HTMLScriptElement ? node : undefined
    const blob = script === undefined ? undefined : scripts.get(script.src)
    if (script === undefined || blob === undefined) return appendChild(node)
    if (appendFailure !== undefined) throw appendFailure
    if (loadFailure) {
      script.dispatchEvent(new Event('error'))
      return script
    }
    const appended = appendChild(node)
    void blob.text().then((source) => {
      try {
        // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call -- simulate an external script.
        new Function(source)()
        script.dispatchEvent(new Event('load'))
      } catch (error) {
        window.dispatchEvent(new ErrorEvent('error', { error, filename: script.src, message: String(error) }))
        script.dispatchEvent(new Event('error'))
      }
    })
    return appended
  })
})

afterEach(() => { vi.restoreAllMocks(); scripts.clear() })

function env(overrides: Partial<DynamicCordisClosureEnv> = {}): DynamicCordisClosureEnv {
  return {
    invoke: () => Promise.resolve(null),
    noteError: () => {},
    ...overrides,
  }
}

/** Evaluate one source with fresh style bookkeeping. */
async function run(source: string, closure: DynamicCordisClosureEnv = env()): Promise<{
  plugin: DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)
  styles: DynamicCordisStyles
}> {
  const styles = new DynamicCordisStyles(ID)
  const plugin = await evaluateClientHalf(ID, source, closure, styles)
  return { plugin, styles }
}

describe('evaluateClientHalf', () => {
  it('returns the object-form plugin and hands the page React instance to the closure', async () => {
    const { plugin } = await run(`
      if (React.createElement === undefined) throw new Error('React symbol missing')
      return { name: 'ignored', inject: ['slots'], apply(ctx) { return React } }
    `)
    expect(typeof plugin).toBe('object')
    const object = plugin as DynamicCordisEvaluatedPlugin
    expect(object.inject).toEqual(['slots'])
    // Same instance as the page's React: a second copy would break hooks.
    expect(object.apply({})).toBe(React)
  })

  it('loads the factory through a revocable Blob script and preserves classic closure semantics', async () => {
    const { plugin } = await run(`
      const captured = [this === globalThis, arguments.length]
      return { apply: () => captured }
    `)
    expect((plugin as DynamicCordisEvaluatedPlugin).apply({})).toEqual([true, 13])
    expect(createdBlobs).toHaveLength(1)
    expect(createdBlobs[0]).toBeInstanceOf(Blob)
    expect(revokedUrls).toHaveLength(1)
    expect(revokedUrls[0]).toMatch(/^blob:/)
    expect(document.head.querySelector('script[src^="blob:"]')).toBeNull()
    expect(Object.keys(globalThis).some(key => key.startsWith('__DSH_CORDIS_CLIENT_HALF_'))).toBe(false)
  })

  it('accepts the function form', async () => {
    const { plugin } = await run('return (ctx) => "applied"')
    expect(typeof plugin).toBe('function')
    expect((plugin as (ctx: unknown) => unknown)({})).toBe('applied')
  })

  it('redirects browser timers to the ctx facade', async () => {
    for (const timer of ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] as const) {
      const { plugin } = await run(`return () => ${timer}(() => {}, 1)`)
      expect(() => (plugin as (ctx: unknown) => unknown)({}))
        .toThrow(DYNAMIC_CLIENT_REDIRECTS[timer])
    }
  })

  it('redirects fetch to the host half and require to the closure symbols', async () => {
    const { plugin: fetcher } = await run('return () => fetch("/x")')
    expect(() => (fetcher as (ctx: unknown) => unknown)({})).toThrow(/network belongs to the HOST half/)
    const { plugin: importer } = await run('return () => require("react")')
    expect(() => (importer as (ctx: unknown) => unknown)({})).toThrow(/React arrives as the `React` closure symbol/)
  })

  it('teaches the half split on any harness access', async () => {
    const { plugin } = await run('return () => harness.handle("m", () => {})')
    expect(() => (plugin as (ctx: unknown) => unknown)({}))
      .toThrow(/harness\.handle belongs to the HOST half/)
  })

  it('routes host.call to the runner invoke seam', async () => {
    const invoke = vi.fn(() => Promise.resolve({ ok: 1 }))
    const { plugin } = await run('return { apply: (ctx) => host.call("ping", { a: 1 }) }', env({ invoke }))
    await expect((plugin as DynamicCordisEvaluatedPlugin).apply({})).resolves.toEqual({ ok: 1 })
    expect(invoke).toHaveBeenCalledWith('ping', { a: 1 })
  })

  it('sends null for a host.call written without arguments', async () => {
    const invoke = vi.fn(() => Promise.resolve(['fs', 'web']))
    // A handler that takes nothing is the natural case ("list the services"), and
    // `undefined` is not JSON — so the omission travels as null rather than
    // making the wire refuse the call.
    const { plugin } = await run('return { apply: (ctx) => host.call("listServices") }', env({ invoke }))
    await expect((plugin as DynamicCordisEvaluatedPlugin).apply({})).resolves.toEqual(['fs', 'web'])
    expect(invoke).toHaveBeenCalledWith('listServices', null)
  })

  it('reports a parse failure as a plain-JavaScript teaching error', async () => {
    await expect(run('return (')).rejects.toThrow(/client half failed to parse in this browser/)
    await expect(run('return (')).rejects.toThrow(/no JSX, no TypeScript/)
  })

  it('names the missing return, rejects non-plugin values, and preserves runtime body errors', async () => {
    await expect(run('const x = 1')).rejects.toThrow(/did you forget `return`/)
    await expect(run('return 42')).rejects.toThrow(/must `return` a plugin/)
    await expect(run('throw new Error("closure body failed")')).rejects.toThrow('closure body failed')
  })

  it('cleans up the script URL and temporary node when a Blob script fails to load', async () => {
    loadFailure = true
    await expect(run('return () => {}')).rejects.toThrow('client half script failed to load')
    expect(revokedUrls).toHaveLength(1)
    expect(document.head.querySelector('script[src^="blob:"]')).toBeNull()
    expect(Object.keys(globalThis).some(key => key.startsWith('__DSH_CORDIS_CLIENT_HALF_'))).toBe(false)
  })

  it('cleans up resources when appending the Blob script throws', async () => {
    const boom = new Error('script attachment failed')
    appendFailure = boom
    await expect(run('return () => {}')).rejects.toBe(boom)
    expect(revokedUrls).toHaveLength(1)
    expect(Object.keys(globalThis).some(key => key.startsWith('__DSH_CORDIS_CLIENT_HALF_'))).toBe(false)
  })

  it('propagates Blob allocation failures untouched', async () => {
    const boom = new TypeError('Blob URLs unavailable')
    allocationFailure = boom
    await expect(run('return () => {}')).rejects.toBe(boom)
    expect(revokedUrls).toHaveLength(0)
  })
})

describe('tagged console', () => {
  it('mirrors only error lines, and stringifies every argument shape', async () => {
    const seen: string[] = []
    const closure = env({ noteError: message => seen.push(message) })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const { plugin } = await run(`
      return { apply: (ctx) => {
        console.log('quiet')
        console.warn('also quiet')
        console.error('text', new Error('boom'), { a: 1 }, undefined, ctx.circular)
        console.debug('quiet too')
      } }
    `, closure)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    ;(plugin as DynamicCordisEvaluatedPlugin).apply({ circular })
    vi.restoreAllMocks()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe('text boom {"a":1} undefined [unserializable console argument]')
  })

  it('truncates a long mirrored error', async () => {
    const seen: string[] = []
    const { plugin } = await run(
      'return { apply: () => console.error("x".repeat(900)) }',
      env({ noteError: message => seen.push(message) }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(plugin as DynamicCordisEvaluatedPlugin).apply({})
    vi.restoreAllMocks()
    expect(seen[0]).toHaveLength(500)
  })
})

describe('DynamicCordisStyles', () => {
  it('stamps ownership, counts live tags, and disposes one tag or all of them', () => {
    const styles = new DynamicCordisStyles(ID)
    const first = styles.insert('.a { color: red }')
    styles.insert('.b { color: blue }')
    expect(styles.count).toBe(2)
    const tags = [...document.querySelectorAll('style[data-dyn="dyn-1"]')]
    expect(tags).toHaveLength(2)
    expect(tags[0]?.textContent).toBe('.a { color: red }')
    first()
    expect(styles.count).toBe(1)
    expect(document.querySelectorAll('style[data-dyn="dyn-1"]')).toHaveLength(1)
    styles.dispose()
    expect(styles.count).toBe(0)
    expect(document.querySelectorAll('style[data-dyn="dyn-1"]')).toHaveLength(0)
  })

  it('rejects a non-string stylesheet', () => {
    const styles = new DynamicCordisStyles(ID)
    expect(() => styles.insert(42 as unknown as string)).toThrow(/needs a CSS string/)
  })

  it('exposes styles.insert to the closure', async () => {
    const { plugin, styles } = await run('return { apply: () => styles.insert(".c {}") }')
    ;(plugin as DynamicCordisEvaluatedPlugin).apply({})
    expect(styles.count).toBe(1)
    styles.dispose()
  })
})

describe('isDynamicCordisPlugin', () => {
  it('accepts both mountable forms and rejects everything else', () => {
    expect(isDynamicCordisPlugin(() => {})).toBe(true)
    expect(isDynamicCordisPlugin({ apply: () => {} })).toBe(true)
    expect(isDynamicCordisPlugin({})).toBe(false)
    expect(isDynamicCordisPlugin(null)).toBe(false)
    expect(isDynamicCordisPlugin(42)).toBe(false)
  })
})
