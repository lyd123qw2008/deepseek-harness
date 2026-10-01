// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { evaluate, interpolate } from '../../../../vendor/loader/src/config/utils.ts'

it('keeps browser client composition independent of dynamic JavaScript evaluation', () => {
  expect(interpolate({}, { value: 'literal' })).toEqual({ value: 'literal' })
  vi.stubGlobal('process', undefined)
  try {
    expect(() => { evaluate({}, '1 + 1') }).toThrow('loader: !!js expressions are unavailable in browser plugin entries')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('does not construct a Function merely by importing the browser Loader', async () => {
  vi.resetModules()
  vi.stubGlobal('Function', function blocked(): never { throw new EvalError('CSP unsafe-eval blocked') })
  try {
    const loader = await import('../../../../vendor/loader/src/config/utils.ts')
    expect(loader.interpolate({}, { value: 'literal' })).toEqual({ value: 'literal' })
  } finally {
    vi.unstubAllGlobals()
  }
})
