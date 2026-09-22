/**
 * Verify that an upgraded data home covers source state without copying isolated secrets.
 * @module scripts/verify-upgrade-environment
 */

import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_MANIFEST_PATH = resolve(import.meta.dirname, 'upgrade-environment.manifest.json')
const HASH_BUFFER_SIZE = 1024 * 1024

/** A source path that must survive an upgrade. */
export interface UpgradeManifestEntry {
  readonly path: string
  readonly kind: string
  readonly strategy: 'union' | 'sqlite'
  readonly sourceMustExist: boolean
  readonly copyTime: 'exact' | 'presence' | 'skip'
  readonly ignoredDescendants: readonly string[]
  readonly companions: readonly string[]
  /** Target path holding the same bytes when the owning application consumes and renames the source path at first start. */
  readonly renamedTo?: string
}

/** A source path that must not be copied as the same bytes into the target. */
export interface UpgradeManifestExclusion {
  readonly path: string
  readonly kind: string
  readonly policy: 'isolate' | 'recreate' | 'reinstall'
}

/** Canonical policy for comparing two DSH data homes. */
export interface UpgradeManifest {
  readonly version: 1
  readonly entries: readonly UpgradeManifestEntry[]
  readonly excluded: readonly UpgradeManifestExclusion[]
}

/** Inputs for a read-only upgrade verification. */
export interface UpgradeVerificationOptions {
  readonly source: string
  readonly target: string
  readonly targetBefore?: string
  readonly phase: 'copy-time' | 'post-migration'
  readonly manifest: UpgradeManifest
}

/** Machine-readable result from the upgrade verifier. */
export interface UpgradeVerificationReport {
  readonly passed: boolean
  readonly phase: UpgradeVerificationOptions['phase']
  readonly source: string
  readonly target: string
  readonly checkedSourceFiles: number
  readonly checkedExactFiles: number
  readonly checkedTargetBaselineFiles: number
  readonly checkedIsolatedFiles: number
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}

interface FileRecord {
  readonly relativePath: string
  readonly absolutePath: string
  readonly size: number
}

interface PathListing {
  readonly exists: boolean
  readonly kind?: 'file' | 'directory' | 'other'
  readonly files: readonly FileRecord[]
}

interface ParsedCliOptions {
  readonly source: string
  readonly target: string
  readonly targetBefore?: string
  readonly phase: UpgradeVerificationOptions['phase']
  readonly manifestPath: string
  readonly json: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false
  return !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
}

function parsePath(value: unknown, label: string): string {
  if (!isSafeRelativePath(value)) throw new Error(`${label} must be a non-empty slash-separated relative path`)
  return value
}

function parseStringArray(value: unknown, label: string, paths = false): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value.map((item, index) => paths ? parsePath(item, `${label}[${String(index)}]`) : item)
}

function parseEntry(value: unknown, index: number): UpgradeManifestEntry {
  if (!isRecord(value)) throw new Error(`entries[${String(index)}] must be an object`)
  const path = parsePath(value.path, `entries[${String(index)}].path`)
  const kind = value.kind
  const strategy = value.strategy
  const copyTime = value.copyTime
  if (typeof kind !== 'string' || kind.length === 0) throw new Error(`entries[${String(index)}].kind must be a non-empty string`)
  if (strategy !== 'union' && strategy !== 'sqlite') throw new Error(`entries[${String(index)}].strategy must be union or sqlite`)
  if (copyTime !== 'exact' && copyTime !== 'presence' && copyTime !== 'skip') {
    throw new Error(`entries[${String(index)}].copyTime must be exact, presence, or skip`)
  }
  if (strategy === 'sqlite' && copyTime === 'exact') throw new Error(`${path}: sqlite entries cannot use exact copy-time checksums`)
  const sourceMustExist = value.sourceMustExist ?? false
  if (typeof sourceMustExist !== 'boolean') throw new Error(`entries[${String(index)}].sourceMustExist must be a boolean`)
  const ignoredDescendants = parseStringArray(value.ignoredDescendants, `entries[${String(index)}].ignoredDescendants`)
  if (ignoredDescendants.some(item => item.length === 0 || item.includes('/') || item === '.' || item === '..')) {
    throw new Error(`entries[${String(index)}].ignoredDescendants must contain directory names`)
  }
  const renamedTo = value.renamedTo === undefined
    ? undefined
    : parsePath(value.renamedTo, `entries[${String(index)}].renamedTo`)
  return {
    path,
    kind,
    strategy,
    sourceMustExist,
    copyTime,
    ignoredDescendants,
    companions: parseStringArray(value.companions, `entries[${String(index)}].companions`, true),
    ...renamedTo === undefined ? {} : { renamedTo },
  }
}

function parseExclusion(value: unknown, index: number): UpgradeManifestExclusion {
  if (!isRecord(value)) throw new Error(`excluded[${String(index)}] must be an object`)
  const path = parsePath(value.path, `excluded[${String(index)}].path`)
  const kind = value.kind
  const policy = value.policy
  if (typeof kind !== 'string' || kind.length === 0) throw new Error(`excluded[${String(index)}].kind must be a non-empty string`)
  if (policy !== 'isolate' && policy !== 'recreate' && policy !== 'reinstall') {
    throw new Error(`excluded[${String(index)}].policy must be isolate, recreate, or reinstall`)
  }
  return { path, kind, policy }
}

/**
 * Parse and validate the canonical upgrade manifest.
 * @param value - JSON-decoded manifest value.
 * @returns the validated manifest.
 */
export function parseUpgradeManifest(value: unknown): UpgradeManifest {
  if (!isRecord(value) || value.version !== 1) throw new Error('upgrade manifest version must be 1')
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new Error('upgrade manifest entries must be a non-empty array')
  if (!Array.isArray(value.excluded)) throw new Error('upgrade manifest excluded must be an array')
  const entries = value.entries.map(parseEntry)
  const excluded = value.excluded.map(parseExclusion)
  const paths = [...entries.map(entry => entry.path), ...excluded.map(entry => entry.path)]
  const duplicate = paths.find((path, index) => paths.indexOf(path) !== index)
  if (duplicate !== undefined) throw new Error(`upgrade manifest repeats path ${duplicate}`)
  return { version: 1, entries, excluded }
}

/**
 * Read and validate a JSON upgrade manifest from disk.
 * @param path - manifest file path.
 * @returns the validated manifest.
 */
export function readUpgradeManifest(path: string): UpgradeManifest {
  return parseUpgradeManifest(JSON.parse(readFileSync(path, 'utf8')) as unknown)
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function pathFor(root: string, relativePath: string): string {
  const candidate = resolve(root, ...relativePath.split('/'))
  const escaped = relative(resolve(root), candidate)
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new Error(`manifest path escapes data home: ${relativePath}`)
  }
  return candidate
}

function listing(root: string, relativePath: string, ignoredDescendants: readonly string[], errors: string[], label: string): PathListing {
  const absolutePath = pathFor(root, relativePath)
  let stat
  try {
    stat = lstatSync(absolutePath)
  } catch (error) {
    if (missing(error)) return { exists: false, files: [] }
    throw error
  }
  if (stat.isSymbolicLink()) {
    errors.push(`${label}: symbolic links are not accepted in migration data paths`)
    return { exists: true, kind: 'other', files: [] }
  }
  if (stat.isFile()) return { exists: true, kind: 'file', files: [{ relativePath: '', absolutePath, size: stat.size }] }
  if (!stat.isDirectory()) {
    errors.push(`${label}: expected a regular file or directory`)
    return { exists: true, kind: 'other', files: [] }
  }

  const files: FileRecord[] = []
  const visit = (directory: string, segments: readonly string[]): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const childSegments = [...segments, entry.name]
      if (ignoredDescendants.some(name => childSegments.includes(name))) continue
      const childPath = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        errors.push(`${label}/${childSegments.join('/')}: symbolic links are not accepted in migration data paths`)
      } else if (entry.isDirectory()) {
        visit(childPath, childSegments)
      } else if (entry.isFile()) {
        files.push({
          relativePath: childSegments.join('/'),
          absolutePath: childPath,
          size: lstatSync(childPath).size,
        })
      } else {
        errors.push(`${label}/${childSegments.join('/')}: expected a regular file`)
      }
    }
  }
  visit(absolutePath, [])
  return { exists: true, kind: 'directory', files }
}

function filesByPath(files: readonly FileRecord[]): Map<string, FileRecord> {
  return new Map(files.map(file => [file.relativePath, file]))
}

function sameFile(left: FileRecord, right: FileRecord): boolean {
  if (left.size !== right.size) return false
  const hash = (file: FileRecord): string => {
    const digest = createHash('sha256')
    const descriptor = openSync(file.absolutePath, 'r')
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_SIZE)
    try {
      let bytesRead = 0
      do {
        bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
        if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead))
      } while (bytesRead > 0)
    } finally {
      closeSync(descriptor)
    }
    return digest.digest('hex')
  }
  return hash(left) === hash(right)
}

function rootDirectory(path: string, name: string): string {
  const canonical = resolve(path)
  const stat = lstatSync(canonical)
  if (!stat.isDirectory()) throw new Error(`${name} must be a directory: ${path}`)
  return canonical
}

function verifyUnion(
  entry: UpgradeManifestEntry,
  sourceRoot: string,
  targetRoot: string,
  phase: UpgradeVerificationOptions['phase'],
  errors: string[],
): { sourceFiles: number; exactFiles: number } {
  const source = listing(sourceRoot, entry.path, entry.ignoredDescendants, errors, `source/${entry.path}`)
  if (!source.exists) {
    if (entry.sourceMustExist) errors.push(`source/${entry.path}: required path is missing`)
    return { sourceFiles: 0, exactFiles: 0 }
  }
  let target = listing(targetRoot, entry.path, entry.ignoredDescendants, errors, `target/${entry.path}`)
  if (!target.exists && entry.renamedTo !== undefined) {
    target = listing(targetRoot, entry.renamedTo, entry.ignoredDescendants, errors, `target/${entry.renamedTo}`)
  }
  if (!target.exists) {
    errors.push(`target/${entry.path}: source path has no target counterpart`)
    return { sourceFiles: source.files.length, exactFiles: 0 }
  }
  if (source.kind !== target.kind) {
    errors.push(`target/${entry.path}: expected ${source.kind}, found ${target.kind}`)
    return { sourceFiles: source.files.length, exactFiles: 0 }
  }
  const targetFiles = filesByPath(target.files)
  let exactFiles = 0
  for (const sourceFile of source.files) {
    const targetFile = targetFiles.get(sourceFile.relativePath)
    const display = sourceFile.relativePath === '' ? entry.path : `${entry.path}/${sourceFile.relativePath}`
    if (targetFile === undefined) {
      errors.push(`target/${display}: source file is missing after migration`)
      continue
    }
    if (phase === 'copy-time' && entry.copyTime === 'exact') {
      exactFiles += 1
      if (!sameFile(sourceFile, targetFile)) errors.push(`target/${display}: copy-time checksum differs from source`)
    }
  }
  return { sourceFiles: source.files.length, exactFiles }
}

function verifySqlite(
  entry: UpgradeManifestEntry,
  sourceRoot: string,
  targetRoot: string,
  errors: string[],
  warnings: string[],
): void {
  const source = listing(sourceRoot, entry.path, [], errors, `source/${entry.path}`)
  if (!source.exists) {
    if (entry.sourceMustExist) errors.push(`source/${entry.path}: required SQLite database is missing`)
    return
  }
  const target = listing(targetRoot, entry.path, [], errors, `target/${entry.path}`)
  if (!target.exists) {
    errors.push(`target/${entry.path}: source SQLite database has no target counterpart`)
  } else if (target.kind !== 'file') {
    errors.push(`target/${entry.path}: expected a SQLite database file`)
  }
  for (const companion of entry.companions) {
    const sourceCompanion = listing(sourceRoot, companion, [], errors, `source/${companion}`)
    const targetCompanion = listing(targetRoot, companion, [], errors, `target/${companion}`)
    if (sourceCompanion.exists && !targetCompanion.exists) {
      warnings.push(`target/${companion}: SQLite sidecar is absent and may have been rebuilt or checkpointed`)
    }
  }
}

function verifyTargetBaseline(
  entry: UpgradeManifestEntry,
  baselineRoot: string,
  targetRoot: string,
  errors: string[],
): number {
  if (entry.strategy === 'sqlite') {
    const baseline = listing(baselineRoot, entry.path, [], errors, `target-before/${entry.path}`)
    if (!baseline.exists) return 0
    const target = listing(targetRoot, entry.path, [], errors, `target/${entry.path}`)
    if (!target.exists) errors.push(`target/${entry.path}: pre-upgrade SQLite state was not retained`)
    return baseline.files.length
  }
  const baseline = listing(baselineRoot, entry.path, entry.ignoredDescendants, errors, `target-before/${entry.path}`)
  if (!baseline.exists) return 0
  const target = listing(targetRoot, entry.path, entry.ignoredDescendants, errors, `target/${entry.path}`)
  if (!target.exists) {
    errors.push(`target/${entry.path}: pre-upgrade target state was not retained`)
    return baseline.files.length
  }
  const targetFiles = filesByPath(target.files)
  for (const file of baseline.files) {
    if (!targetFiles.has(file.relativePath)) {
      const display = file.relativePath === '' ? entry.path : `${entry.path}/${file.relativePath}`
      errors.push(`target/${display}: target-only pre-upgrade file was removed`)
    }
  }
  return baseline.files.length
}

function verifyExcluded(
  exclusion: UpgradeManifestExclusion,
  sourceRoot: string,
  targetRoot: string,
  errors: string[],
): number {
  if (exclusion.policy !== 'isolate') return 0
  const source = listing(sourceRoot, exclusion.path, [], errors, `source/${exclusion.path}`)
  if (!source.exists) return 0
  const target = listing(targetRoot, exclusion.path, [], errors, `target/${exclusion.path}`)
  if (!target.exists) return 0
  const targetFiles = filesByPath(target.files)
  let checked = 0
  for (const sourceFile of source.files) {
    const targetFile = targetFiles.get(sourceFile.relativePath)
    if (targetFile === undefined) continue
    checked += 1
    if (sameFile(sourceFile, targetFile)) {
      const display = sourceFile.relativePath === '' ? exclusion.path : `${exclusion.path}/${sourceFile.relativePath}`
      errors.push(`target/${display}: isolated source secret or identity was copied unchanged`)
    }
  }
  return checked
}

/**
 * Verify source coverage, target-only retention, SQLite presence, and secret isolation.
 * @param options - data homes, phase, and manifest policy.
 * @returns a deterministic verification report.
 */
export function verifyUpgradeEnvironment(options: UpgradeVerificationOptions): UpgradeVerificationReport {
  const errors: string[] = []
  const warnings: string[] = []
  const source = rootDirectory(options.source, 'source')
  const target = rootDirectory(options.target, 'target')
  if (source === target) throw new Error('source and target must be different data homes')
  const baseline = options.targetBefore === undefined ? undefined : rootDirectory(options.targetBefore, 'target-before')
  if (baseline !== undefined && baseline === target) throw new Error('target-before must be different from target')

  let checkedSourceFiles = 0
  let checkedExactFiles = 0
  let checkedTargetBaselineFiles = 0
  let checkedIsolatedFiles = 0
  for (const entry of options.manifest.entries) {
    if (entry.strategy === 'sqlite') {
      verifySqlite(entry, source, target, errors, warnings)
    } else {
      const result = verifyUnion(entry, source, target, options.phase, errors)
      checkedSourceFiles += result.sourceFiles
      checkedExactFiles += result.exactFiles
    }
    if (baseline !== undefined) checkedTargetBaselineFiles += verifyTargetBaseline(entry, baseline, target, errors)
  }
  for (const exclusion of options.manifest.excluded) {
    checkedIsolatedFiles += verifyExcluded(exclusion, source, target, errors)
  }
  return {
    passed: errors.length === 0,
    phase: options.phase,
    source,
    target,
    checkedSourceFiles,
    checkedExactFiles,
    checkedTargetBaselineFiles,
    checkedIsolatedFiles,
    warnings,
    errors,
  }
}

function optionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parseCliOptions(argv: readonly string[]): ParsedCliOptions | undefined {
  if (argv.includes('--help') || argv.includes('-h')) return undefined
  let source: string | undefined
  let target: string | undefined
  let targetBefore: string | undefined
  let phase: ParsedCliOptions['phase'] = 'post-migration'
  let manifestPath = DEFAULT_MANIFEST_PATH
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--source') source = optionValue(argv, index++, flag)
    else if (flag === '--target') target = optionValue(argv, index++, flag)
    else if (flag === '--target-before') targetBefore = optionValue(argv, index++, flag)
    else if (flag === '--manifest') manifestPath = resolve(optionValue(argv, index++, flag))
    else if (flag === '--phase') {
      const value = optionValue(argv, index++, flag)
      if (value !== 'copy-time' && value !== 'post-migration') throw new Error('--phase must be copy-time or post-migration')
      phase = value
    } else if (flag === '--json') json = true
    else throw new Error(`unknown option: ${flag}`)
  }
  if (source === undefined || target === undefined) throw new Error('--source and --target are required; an upgrade target is never implicit')
  const options: ParsedCliOptions = { source: resolve(source), target: resolve(target), phase, manifestPath, json }
  return targetBefore === undefined ? options : { ...options, targetBefore: resolve(targetBefore) }
}

function printHelp(): void {
  console.log('Usage: pnpm run verify-upgrade-environment --source <home> --target <home> [options]')
  console.log('Options:')
  console.log('  --target-before <home>  Full pre-upgrade target backup to protect target-only files')
  console.log('  --phase <copy-time|post-migration>  Verification phase (default: post-migration)')
  console.log('  --manifest <file>       Upgrade manifest (default: scripts/upgrade-environment.manifest.json)')
  console.log('  --json                  Print the report as JSON')
}

function printReport(report: UpgradeVerificationReport): void {
  console.log(`verify-upgrade-environment: ${report.passed ? 'passed' : 'failed'} (${report.phase})`)
  console.log(`  source files checked: ${String(report.checkedSourceFiles)}`)
  console.log(`  exact files checked: ${String(report.checkedExactFiles)}`)
  console.log(`  target-baseline files checked: ${String(report.checkedTargetBaselineFiles)}`)
  console.log(`  isolated files checked: ${String(report.checkedIsolatedFiles)}`)
  for (const warning of report.warnings) console.warn(`  warning: ${warning}`)
  for (const error of report.errors) console.error(`  error: ${error}`)
}

function main(): void {
  try {
    const options = parseCliOptions(process.argv.slice(2))
    if (options === undefined) {
      printHelp()
      return
    }
    const manifest = readUpgradeManifest(options.manifestPath)
    const verificationOptions: UpgradeVerificationOptions = options.targetBefore === undefined
      ? { source: options.source, target: options.target, phase: options.phase, manifest }
      : { source: options.source, target: options.target, targetBefore: options.targetBefore, phase: options.phase, manifest }
    const report = verifyUpgradeEnvironment(verificationOptions)
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else printReport(report)
    if (!report.passed) process.exitCode = 1
  } catch (error) {
    console.error(`verify-upgrade-environment: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
