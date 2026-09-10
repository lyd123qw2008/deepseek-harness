import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { checkWebLaunchers, renderWebLaunchers, writeWebLaunchers, type WebLauncherOptions } from './upgrade-web-launchers.ts'

const roots: string[] = []

function fixture(): WebLauncherOptions {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-launchers-'))
  roots.push(root)
  const dataHome = join(root, 'data')
  const codeHome = join(root, 'code')
  mkdirSync(dataHome)
  mkdirSync(codeHome)
  return { dataHome, codeHome, release: '0.1.5-alpha.2', port: 3089 }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('upgrade Web launchers', () => {
  it('writes and verifies all five launchers from one target description', () => {
    const options = fixture()

    writeWebLaunchers(options)

    expect(checkWebLaunchers(options)).toEqual([])
    expect(Object.keys(renderWebLaunchers(options))).toEqual([
      'restart-web-3089.cmd',
      'restart-web-3089.ps1',
      'run-web-3089.ps1',
      'start-web-3089.cmd',
      'stop-web-3089.cmd',
    ])
    expect(readFileSync(join(options.dataHome, 'restart-web-3089.cmd'), 'utf8')).toContain('restart-web-3089.ps1')
    expect(existsSync(join(options.dataHome, 'start-web-3089.cmd'))).toBe(true)
  })

  it('reports a missing launcher and copied launchers for another port', () => {
    const options = fixture()
    writeWebLaunchers(options)
    unlinkSync(join(options.dataHome, 'restart-web-3089.cmd'))
    writeFileSync(join(options.dataHome, 'start-web-3088.cmd'), 'stale')

    expect(checkWebLaunchers(options)).toEqual(expect.arrayContaining([
      'restart-web-3089.cmd: launcher is missing',
      'start-web-3088.cmd: launcher belongs to another port',
    ]))
  })
})
