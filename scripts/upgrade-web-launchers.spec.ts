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

  it('decodes native child output as UTF-8 so the log keeps its check marks and CJK text', () => {
    const options = fixture()

    writeWebLaunchers(options)

    // Windows PowerShell 5.1 otherwise decodes a native command's stdout with the
    // console code page, which turns the UTF-8 a provider or MCP child prints into
    // mojibake in the mirrored log.
    const run = readFileSync(join(options.dataHome, 'run-web-3089.ps1'), 'utf8')
    expect(run).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
  })

  it('logs a native stderr line as its message rather than its exception type name', () => {
    const options = fixture()

    writeWebLaunchers(options)

    // 5.1 turns each native stderr line into an ErrorRecord. A blank line's record has an
    // empty message, so `[string]$_` yields `System.Management.Automation.RemoteException`
    // and the blank line around a provider's notice becomes that line in the log.
    const run = readFileSync(join(options.dataHome, 'run-web-3089.ps1'), 'utf8')
    expect(run).toContain('$item.Exception.Message')
  })

  it('renders legacy TLS setup when the target data home carries its config', () => {
    const options = fixture()
    writeFileSync(join(options.dataHome, 'openssl-legacy.cnf'), 'legacy')

    writeWebLaunchers(options)

    const start = readFileSync(join(options.dataHome, 'start-web-3089.cmd'), 'utf8')
    expect(start).toContain('rem TEMPORARY: allow the legacy TLS renegotiation required by the DeepSeek gateway.')
    expect(start).toContain('set "OPENSSL_CONF=%DSH_HOME%\\openssl-legacy.cnf"')
    expect(start).toContain('set "NODE_OPTIONS=%NODE_OPTIONS% --openssl-shared-config --openssl-config=%DSH_HOME%\\openssl-legacy.cnf"')
    expect(checkWebLaunchers(options)).toEqual([])
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
