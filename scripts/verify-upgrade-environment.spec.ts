import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UpgradeManifest } from './verify-upgrade-environment.ts'
import { verifyUpgradeEnvironment } from './verify-upgrade-environment.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upgrade-environment-'))
  roots.push(root)
  return root
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function manifest(): UpgradeManifest {
  return {
    version: 1,
    entries: [
      {
        path: 'sessions',
        kind: 'session-log',
        strategy: 'union',
        sourceMustExist: true,
        copyTime: 'exact',
        ignoredDescendants: [],
        companions: [],
      },
      {
        path: 'settings.yaml',
        kind: 'settings',
        strategy: 'union',
        sourceMustExist: true,
        copyTime: 'exact',
        ignoredDescendants: [],
        companions: [],
      },
      {
        path: 'storages/session-query.sqlite',
        kind: 'session-query-sqlite',
        strategy: 'sqlite',
        sourceMustExist: true,
        copyTime: 'skip',
        ignoredDescendants: [],
        companions: ['storages/session-query.sqlite-shm', 'storages/session-query.sqlite-wal'],
      },
    ],
    excluded: [{ path: '.credentials.yaml', kind: 'secret', policy: 'isolate' }],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyUpgradeEnvironment', () => {
  it('preserves source files, target-only files, SQLite state, and isolated secrets', () => {
    const root = fixture()
    const source = join(root, 'source')
    const target = join(root, 'target')
    const before = join(root, 'target-before')
    write(join(source, 'sessions/source.jsonl.zstd'), 'source-session')
    write(join(source, 'settings.yaml'), 'source-settings')
    write(join(source, 'storages/session-query.sqlite'), 'source-index')
    write(join(source, 'storages/session-query.sqlite-wal'), 'source-wal')
    write(join(source, '.credentials.yaml'), 'source-secret')
    write(join(target, 'sessions/source.jsonl.zstd'), 'source-session')
    write(join(target, 'sessions/target-only.jsonl.zstd'), 'target-session')
    write(join(target, 'settings.yaml'), 'source-settings')
    write(join(target, 'storages/session-query.sqlite'), 'target-index')
    write(join(target, '.credentials.yaml'), 'target-secret')
    write(join(before, 'sessions/target-only.jsonl.zstd'), 'target-session')
    write(join(before, 'storages/session-query.sqlite'), 'old-index')

    const report = verifyUpgradeEnvironment({ source, target, targetBefore: before, phase: 'copy-time', manifest: manifest() })

    expect(report.passed).toBe(true)
    expect(report.checkedSourceFiles).toBe(2)
    expect(report.checkedExactFiles).toBe(2)
    expect(report.checkedTargetBaselineFiles).toBe(2)
    expect(report.checkedIsolatedFiles).toBe(1)
    expect(report.warnings).toContain('target/storages/session-query.sqlite-wal: SQLite sidecar is absent and may have been rebuilt or checkpointed')
  })

  it('rejects missing source coverage and unchanged isolated secrets', () => {
    const root = fixture()
    const source = join(root, 'source')
    const target = join(root, 'target')
    write(join(source, 'sessions/source.jsonl.zstd'), 'source-session')
    write(join(source, 'settings.yaml'), 'source-settings')
    write(join(source, 'storages/session-query.sqlite'), 'source-index')
    write(join(source, '.credentials.yaml'), 'source-secret')
    write(join(target, 'sessions/other.jsonl.zstd'), 'other-session')
    write(join(target, 'settings.yaml'), 'changed-settings')
    write(join(target, 'storages/session-query.sqlite'), 'target-index')
    write(join(target, '.credentials.yaml'), 'source-secret')

    const report = verifyUpgradeEnvironment({ source, target, phase: 'post-migration', manifest: manifest() })

    expect(report.passed).toBe(false)
    expect(report.errors).toEqual(expect.arrayContaining([
      'target/sessions/source.jsonl.zstd: source file is missing after migration',
      'target/.credentials.yaml: isolated source secret or identity was copied unchanged',
    ]))
  })

  it('allows intentional durable-file rewrites after the copy-time phase', () => {
    const root = fixture()
    const source = join(root, 'source')
    const target = join(root, 'target')
    write(join(source, 'sessions/source.jsonl.zstd'), 'source-session')
    write(join(source, 'settings.yaml'), 'source-settings')
    write(join(source, 'storages/session-query.sqlite'), 'source-index')
    write(join(target, 'sessions/source.jsonl.zstd'), 'migrated-session')
    write(join(target, 'settings.yaml'), 'adapted-settings')
    write(join(target, 'storages/session-query.sqlite'), 'rebuilt-index')

    const report = verifyUpgradeEnvironment({ source, target, phase: 'post-migration', manifest: manifest() })

    expect(report.passed).toBe(true)
    expect(report.checkedExactFiles).toBe(0)
  })
})
