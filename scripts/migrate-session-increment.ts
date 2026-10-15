/**
 * Move incremental Session data into an already-migrated data home.
 *
 * An upgrade creates the target home from a snapshot; the Session that served
 * that copy keeps growing in the source home. This command re-syncs the delta
 * (Session generations, attachments, projection cache, derived indexes) and
 * verifies the result with the product's own frame decoder, then optionally
 * restarts the target instance so it reloads its Sessions from disk.
 *
 * The path policy is [`scripts/upgrade-environment.manifest.json`](./upgrade-environment.manifest.json):
 * `sessions` and `attachments` are exact copies, the SQLite databases are
 * consistent online backups, and the projection cache is presence-only.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

/** Session generations in rotation order; every one carries the same history. */
const GENERATIONS = ['session.jsonl.zstd', 'session.v2.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.v4.jsonl.zstd']

/** Presence-only trees the policy copies besides Sessions and attachments. */
const SUPPORT_TREES = ['storages/session_projcache'] as const

/** Databases the derived indexes live in, backed up only with `--index`. */
const DATABASES = ['storages/engram/engram.db', 'storages/session-query.sqlite'] as const

/** User-scope variables the launcher must not inherit from an agent shell's current values. */
const SYSTEM_ENVIRONMENT = new Set(['Path', 'TEMP', 'TMP', 'JAVA_HOME'])

/** Frame and event counts one generation holds, as read by the product decoder. */
interface GenerationCounts {
  readonly bytes: number
  readonly frames: number
  readonly events: number
  readonly tornStart: number | null
}

/** One Session generation across both homes. */
interface GenerationReport {
  readonly file: string
  readonly source?: GenerationCounts
  readonly target?: GenerationCounts
  readonly identical: boolean
}

/** One Session's delta and verification result. */
interface SessionReport {
  readonly project: string
  readonly session: string
  readonly copied: readonly string[]
  readonly wasBehind: boolean
  readonly generations: readonly GenerationReport[]
  readonly identical: boolean
}

/** The whole run, printed as a summary or as JSON. */
interface MigrationReport {
  source: string
  target: string
  checked: boolean
  sessions: SessionReport[]
  attachments?: { readonly copied: number; readonly files: number }
  indexes?: readonly string[]
  restarted?: { readonly port: number; readonly url: string }
}

/** What one mirrored tree changed. */
interface MirrorResult {
  readonly copied: readonly string[]
  readonly removed: readonly string[]
  readonly files: number
}

/** The product's frame reader, loaded from the code home that owns it. */
interface ZstdModule {
  readonly scanZstdFrames: (bytes: Uint8Array) => { readonly frames: readonly unknown[]; readonly tornStart?: number }
  readonly createZstdFrameDecoder: () => {
    decode: (bytes: Uint8Array, frames: readonly unknown[]) => Iterable<Buffer>
  }
}

/**
 * List one directory's files as paths relative to itself.
 * @param root - directory to walk.
 * @returns relative paths of every regular file below it, empty when absent.
 */
function listFiles(root: string): string[] {
  if (!existsSync(root)) return []
  if (!statSync(root).isDirectory()) throw new Error(`expected a directory: ${root}`)
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) found.push(relative(root, child))
      else throw new Error(`unsupported data-home entry: ${child}`)
    }
  }
  visit(root)
  return found
}

/**
 * Copy changed files and, when asked, drop files the source no longer has.
 * @param source - directory to mirror from.
 * @param target - directory to mirror into.
 * @param prune - whether target-only files are removed.
 * @returns the copied and removed relative paths plus the resulting file count.
 */
function mirrorTree(source: string, target: string, prune: boolean): MirrorResult {
  const copied: string[] = []
  const removed: string[] = []
  const sourceFiles = listFiles(source)
  if (sourceFiles.length > 0) mkdirSync(target, { recursive: true })
  for (const file of sourceFiles) {
    const from = join(source, file)
    const to = join(target, file)
    const fromStat = statSync(from)
    const current = existsSync(to) ? statSync(to) : undefined
    if (current !== undefined && current.size === fromStat.size && current.mtimeMs === fromStat.mtimeMs) continue
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied.push(file)
  }
  if (prune) {
    const sourceSet = new Set(sourceFiles)
    for (const file of listFiles(target)) {
      if (sourceSet.has(file)) continue
      rmSync(join(target, file))
      removed.push(file)
    }
  }
  return { copied, removed, files: listFiles(target).length }
}

/**
 * Copy one file when it differs, creating parent directories.
 * @param from - absolute source file.
 * @param to - absolute target file.
 * @returns whether the file was copied.
 */
function copyChangedFile(from: string, to: string): boolean {
  const fromStat = statSync(from)
  const current = existsSync(to) ? statSync(to) : undefined
  if (current !== undefined && current.size === fromStat.size && current.mtimeMs === fromStat.mtimeMs) return false
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  return true
}

/**
 * Hash one file's bytes.
 * @param file - absolute path to read.
 * @returns the lowercase SHA-256 digest in hexadecimal.
 */
function hash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Decode one packed generation through the product's own frame reader.
 * @param file - absolute generation path.
 * @param zstd - the product's zstd module.
 * @returns the byte, frame, and event counts, or undefined when the file is absent.
 */
function readGeneration(file: string, zstd: ZstdModule): GenerationCounts | undefined {
  if (!existsSync(file)) return undefined
  const bytes = readFileSync(file)
  const scanned = zstd.scanZstdFrames(bytes)
  let header = true
  let events = 0
  for (const plaintext of zstd.createZstdFrameDecoder().decode(bytes, scanned.frames)) {
    for (const line of plaintext.toString('utf8').split('\n')) {
      if (line.trim() === '') continue
      if (header) header = false
      else events += 1
    }
  }
  return { bytes: bytes.byteLength, frames: scanned.frames.length, events, tornStart: scanned.tornStart ?? null }
}

/**
 * Compare one Session's generations across both homes without writing anything.
 * @param sourceHome - home the live Session writes to.
 * @param targetHome - home the new instance serves.
 * @param project - Session project directory name.
 * @param session - Session directory name.
 * @param zstd - the product's zstd module.
 * @returns per-generation reports and whether every generation is byte-identical.
 */
function compareSession(
  sourceHome: string,
  targetHome: string,
  project: string,
  session: string,
  zstd: ZstdModule,
): GenerationReport[] {
  const sourceRoot = join(sourceHome, 'sessions', project, session)
  const targetRoot = join(targetHome, 'sessions', project, session)
  return GENERATIONS.map((file): GenerationReport => {
    const from = join(sourceRoot, file)
    const to = join(targetRoot, file)
    const source = readGeneration(from, zstd)
    const target = readGeneration(to, zstd)
    // A generation both homes lack is simply not part of this Session's history,
    // so it is not a difference; one side only is a real gap.
    const identical = source === undefined && target === undefined
      ? true
      : source !== undefined && target !== undefined && hash(from) === hash(to)
    return { file, ...(source === undefined ? {} : { source }), ...(target === undefined ? {} : { target }), identical }
  })
}

/**
 * Sync one Session, retrying once because the source home keeps appending.
 * @param sourceHome - home the live Session writes to.
 * @param targetHome - home the new instance serves.
 * @param project - Session project directory name.
 * @param session - Session directory name.
 * @param zstd - the product's zstd module.
 * @param copy - whether files are copied, false for a check-only run.
 * @returns the Session report with pre-copy and post-copy states.
 */
function syncSession(
  sourceHome: string,
  targetHome: string,
  project: string,
  session: string,
  zstd: ZstdModule,
  copy: boolean,
): SessionReport {
  const before = compareSession(sourceHome, targetHome, project, session, zstd)
  const wasBehind = before.some(generation => !generation.identical)
  let copied: readonly string[] = []
  if (copy) {
    const sourceRoot = join(sourceHome, 'sessions', project, session)
    const targetRoot = join(targetHome, 'sessions', project, session)
    copied = mirrorTree(sourceRoot, targetRoot, false).copied
    if (!compareSession(sourceHome, targetHome, project, session, zstd).every(generation => generation.identical)) {
      copied = [...copied, ...mirrorTree(sourceRoot, targetRoot, false).copied]
    }
  }
  const after = compareSession(sourceHome, targetHome, project, session, zstd)
  return {
    project,
    session,
    copied,
    wasBehind,
    generations: after,
    identical: after.every(generation => generation.identical),
  }
}

/**
 * Read one SQLite database through node:sqlite's consistent online backup.
 * @param source - absolute database path in the source home.
 * @param target - absolute database path in the target home.
 * @returns the size written, or undefined when the source lacks the database.
 */
async function backupDatabase(source: string, target: string): Promise<number | undefined> {
  if (!existsSync(source)) return undefined
  const { DatabaseSync, backup } = await import('node:sqlite')
  mkdirSync(dirname(target), { recursive: true })
  const database = new DatabaseSync(source, { readOnly: true })
  try {
    await backup(database, target)
  } finally {
    database.close()
  }
  return statSync(target).size
}

/**
 * Read the tokenized URL one instance printed on its last start.
 * @param home - data home holding `logs/web-<port>.log`.
 * @param port - instance port.
 * @returns the URL, or undefined when the log has no start line.
 */
function readInstanceUrl(home: string, port: number): string | undefined {
  const log = join(home, 'logs', `web-${String(port)}.log`)
  if (!existsSync(log)) return undefined
  const match = /dsh web: (\S+)/u.exec(readFileSync(log, 'utf8'))
  return match?.[1]
}

/**
 * Read the current user's environment variables from the User scope.
 *
 * An agent shell starts without the provider keys the user set in their own
 * session, so the launcher needs them re-injected; the system-managed `Path`
 * and temp variables must keep the values the launcher already has.
 * @returns the variable names and values the current user has set.
 */
function readUserEnvironment(): Record<string, string | undefined> {
  const listed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    '[Environment]::GetEnvironmentVariables("User") | ConvertTo-Json -Compress'], { encoding: 'utf8' })
  if (listed.status !== 0 || listed.stdout.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(listed.stdout)
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed as Record<string, string | undefined>
  } catch {
    return {}
  }
}

/**
 * Stop one target instance through its generated launcher.
 *
 * The index refresh replaces SQLite files, and a running instance holds them
 * open, so the instance stops before any copy and restarts after them.
 * @param home - target data home holding the launchers.
 * @param port - instance port.
 */
function stopInstance(home: string, port: number): void {
  if (process.platform !== 'win32') throw new Error('--restart currently supports the Windows launchers only')
  const stop = join(home, `stop-web-${String(port)}.cmd`)
  if (!existsSync(stop)) throw new Error(`no stop launcher for port ${String(port)} in ${home}`)
  spawnSync('cmd.exe', ['/c', stop], { stdio: 'ignore' })
}

/**
 * Start one target instance so it reloads its Sessions from disk, and wait for
 * the URL it prints.
 *
 * A running instance keeps every loaded Session in memory, so replacing its log
 * files changes nothing until the process restarts.
 * @param home - target data home holding the launchers.
 * @param port - instance port.
 * @returns the URL the started instance printed.
 */
async function startInstance(home: string, port: number): Promise<string> {
  if (process.platform !== 'win32') throw new Error('--restart currently supports the Windows launchers only')
  const start = join(home, `start-web-${String(port)}.cmd`)
  if (!existsSync(start)) throw new Error(`no start launcher for port ${String(port)} in ${home}`)
  const log = join(home, 'logs', `web-${String(port)}.log`)
  const before = existsSync(log) ? statSync(log).mtimeMs : 0
  const environment: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(readUserEnvironment())) {
    if (SYSTEM_ENVIRONMENT.has(key) || value === undefined) continue
    environment[key] = value
  }
  // `detached` plus `unref` is what lets the instance outlive this command: the
  // launcher returns immediately and the server keeps the port from here on.
  await new Promise<void>((settle, fail) => {
    const child = spawn('cmd.exe', ['/c', start], { env: environment, detached: true, stdio: 'ignore' })
    child.on('error', fail)
    child.on('spawn', () => {
      child.unref()
      settle()
    })
  })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const url = readInstanceUrl(home, port)
    if (url !== undefined && existsSync(log) && statSync(log).mtimeMs > before) return url
    await delay(2000)
  }
  throw new Error(`port ${String(port)} printed no URL within 120s`)
}

/**
 * Run the incremental Session migration described by the module JSDoc.
 * @returns nothing; sets a failing exit code when `--check` finds the target behind.
 */
async function main(): Promise<void> {
  // `pnpm run <script> -- <flags>` forwards the separator itself, and parseArgs
  // reads a leading `--` as the end-of-options marker.
  const argv = process.argv.slice(2)
  if (argv[0] === '--') argv.shift()
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      session: { type: 'string', multiple: true },
      'code-home': { type: 'string' },
      attachments: { type: 'boolean', default: true },
      index: { type: 'boolean', default: false },
      prune: { type: 'boolean', default: false },
      restart: { type: 'string' },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  // `pnpm run <script> -- <flags>` forwards the separator itself on some pnpm releases.
  const stray = positionals.filter(positional => positional !== '--')
  if (stray.length > 0) throw new Error(`unexpected argument: ${stray.join(' ')}`)
  const source = values.source === undefined ? undefined : resolve(values.source)
  const target = values.target === undefined ? undefined : resolve(values.target)
  if (source === undefined || target === undefined) {
    throw new Error('usage: --source <home> --target <home> [--session <id>…] [--code-home <worktree>]'
      + ' [--index] [--prune] [--restart <port>] [--check] [--json]')
  }
  if (!existsSync(source)) throw new Error(`source home does not exist: ${source}`)
  if (!existsSync(target)) throw new Error(`target home does not exist: ${target}`)
  const codeHome = resolve(values['code-home'] ?? join(import.meta.dirname, '..'))
  const zstd = await import(
    pathToFileURL(join(codeHome, 'packages/session/session-persistence-jsonl/src/zstd.ts')).href,
  ) as ZstdModule

  const wanted = new Set(values.session ?? [])
  const selected: { project: string; session: string }[] = []
  const sessionsRoot = join(source, 'sessions')
  if (existsSync(sessionsRoot)) {
    for (const project of readdirSync(sessionsRoot)) {
      if (!statSync(join(sessionsRoot, project)).isDirectory()) continue
      for (const session of readdirSync(join(sessionsRoot, project))) {
        if (!statSync(join(sessionsRoot, project, session)).isDirectory()) continue
        if (wanted.size > 0 && !wanted.has(session)) continue
        selected.push({ project, session })
      }
    }
  }
  if (selected.length === 0) throw new Error('no Session matched the source home and --session filters')

  const copy = !values.check
  const restartPort = values.restart === undefined ? undefined : Number(values.restart)
  if (restartPort !== undefined && !Number.isInteger(restartPort)) throw new Error('--restart must be a port number')
  if (restartPort !== undefined && values.check) throw new Error('--check and --restart are mutually exclusive')
  // The index refresh replaces SQLite files the running instance holds open, and
  // a running instance never re-reads a Session it already loaded, so the target
  // stops before the copy and starts again after it.
  if (restartPort !== undefined) stopInstance(target, restartPort)
  const report: MigrationReport = {
    source,
    target,
    checked: values.check,
    sessions: selected.map(({ project, session }) => syncSession(source, target, project, session, zstd, copy)),
  }
  if (values.attachments && copy) {
    const mirror = mirrorTree(join(source, 'attachments'), join(target, 'attachments'), values.prune)
    report.attachments = { copied: mirror.copied.length, files: mirror.files }
  }
  if (copy) {
    for (const tree of SUPPORT_TREES) mirrorTree(join(source, tree), join(target, tree), values.prune)
    const workspace = 'storages/workspace.json'
    if (existsSync(join(source, workspace))) copyChangedFile(join(source, workspace), join(target, workspace))
  }
  if (values.index) {
    const written: string[] = []
    for (const database of DATABASES) {
      const bytes = await backupDatabase(join(source, database), join(target, database))
      if (bytes !== undefined) written.push(`${database} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    }
    report.indexes = written
  }
  if (restartPort !== undefined) report.restarted = { port: restartPort, url: await startInstance(target, restartPort) }

  const behind = report.sessions.filter(session => !session.identical)
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`source ${source}`)
    console.log(`target ${target}`)
    for (const session of report.sessions) {
      const detail = session.generations
        .filter(generation => generation.source !== undefined)
        .map((generation) => {
          const counts = `${String(generation.source?.frames ?? 0)}f/${String(generation.source?.events ?? 0)}e`
          return `${generation.file} ${counts}${generation.identical ? ' identical' : ' differs'}`
        })
        .join('; ')
      console.log(`  ${session.session}: ${String(session.copied.length)} file(s) copied, was behind: ${String(session.wasBehind)} — ${detail}`)
    }
    if (report.attachments !== undefined) {
      console.log(`  attachments: ${String(report.attachments.files)} file(s), ${String(report.attachments.copied)} copied`)
    }
    if (report.indexes !== undefined) console.log(`  indexes: ${report.indexes.join(', ') || 'none'}`)
    if (report.restarted !== undefined) {
      console.log(`  restarted port ${String(report.restarted.port)}: ${report.restarted.url}`)
    }
    if (behind.length === 0) console.log('all generations byte-identical')
    else {
      const shown = behind.slice(0, 5).map(session => session.session).join(', ')
      const more = behind.length > 5 ? `, +${String(behind.length - 5)} more` : ''
      console.log(`${String(behind.length)} Session(s) still differ (the source home is live): ${shown}${more}`)
      // The source grows while this runs, so name the generations that differ.
      for (const session of behind.slice(0, 5)) {
        const files = session.generations.filter(generation => !generation.identical).map(generation => generation.file)
        console.log(`  ${session.session}: ${files.join(', ')}`)
      }
    }
  }
  if (values.check && behind.length > 0) process.exitCode = 1
}

await main()
