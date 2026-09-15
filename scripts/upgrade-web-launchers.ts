/**
 * Generate and verify the Windows Web launchers for an isolated DSH upgrade home.
 * @module scripts/upgrade-web-launchers
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The inputs that identify one isolated Web installation. */
export interface WebLauncherOptions {
  /** Data home used as `DSH_HOME`. */
  readonly dataHome: string
  /** Code worktree that contains the compiled CLI. */
  readonly codeHome: string
  /** Release label printed by the launchers. */
  readonly release: string
  /** Loopback Web port owned by the installation. */
  readonly port: number
}

interface NormalizedWebLauncherOptions {
  readonly dataHome: string
  readonly codeHome: string
  readonly release: string
  readonly port: number
  readonly legacyTls: boolean
}

interface WebLauncherNames {
  readonly restartCmd: string
  readonly restartPs1: string
  readonly runPs1: string
  readonly startCmd: string
  readonly stopCmd: string
}

const PORT_RANGE = { min: 1, max: 65535 }
const STALE_LAUNCHER_PATTERN = /^(?:restart|run|start|stop)-web-(\d+)\.(?:cmd|ps1)$/i

function pathValue(value: string, label: string): string {
  if (!isAbsolute(value) || /[\"\r\n]/.test(value)) throw new Error(`${label} must be an absolute path without quotes or newlines`)
  const result = resolve(value)
  if (/[\"\r\n]/.test(result)) throw new Error(`${label} must be an absolute path without quotes or newlines`)
  return result
}

function normalizedOptions(options: WebLauncherOptions): NormalizedWebLauncherOptions {
  if (!Number.isInteger(options.port) || options.port < PORT_RANGE.min || options.port > PORT_RANGE.max) {
    throw new Error(`port must be an integer from ${String(PORT_RANGE.min)} to ${String(PORT_RANGE.max)}`)
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.release)) throw new Error('release must contain only letters, digits, dots, underscores, or hyphens')
  const dataHome = pathValue(options.dataHome, 'dataHome')
  const codeHome = pathValue(options.codeHome, 'codeHome')
  if (dataHome === codeHome) throw new Error('dataHome and codeHome must be different directories')
  return {
    dataHome,
    codeHome,
    release: options.release,
    port: options.port,
    legacyTls: existsSync(join(dataHome, 'openssl-legacy.cnf')),
  }
}

function launcherNames(port: number): WebLauncherNames {
  return {
    restartCmd: `restart-web-${String(port)}.cmd`,
    restartPs1: `restart-web-${String(port)}.ps1`,
    runPs1: `run-web-${String(port)}.ps1`,
    startCmd: `start-web-${String(port)}.cmd`,
    stopCmd: `stop-web-${String(port)}.cmd`,
  }
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function cmdLiteral(value: string): string {
  return `"${value}"`
}

function lines(values: readonly string[], newline: '\n' | '\r\n'): string {
  return `${values.join(newline)}${newline}`
}

function renderStart(options: NormalizedWebLauncherOptions, names: WebLauncherNames): string {
  const codeHome = cmdLiteral(options.codeHome)
  const legacyTlsLines = options.legacyTls
    ? [
      'rem TEMPORARY: allow the legacy TLS renegotiation required by the DeepSeek gateway.',
      'set "OPENSSL_CONF=%DSH_HOME%\\openssl-legacy.cnf"',
      'set "NODE_OPTIONS=%NODE_OPTIONS% --openssl-shared-config --openssl-config=%DSH_HOME%\\openssl-legacy.cnf"',
    ]
    : []
  return lines([
    '@echo off',
    `set "DSH_HOME=${options.dataHome}"`,
    ...legacyTlsLines,
    `cd /d ${codeHome}`,
    'if not exist "%DSH_HOME%\\logs" mkdir "%DSH_HOME%\\logs"',
    `echo Starting DSH ${options.release} Web on port ${String(options.port)}...`,
    `echo Startup output is mirrored to "%DSH_HOME%\\logs\\web-${String(options.port)}.log"`,
    `echo $ node apps/cli/lib/bin.js "web" "--no-open" "--port" "${String(options.port)}"`,
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DSH_HOME%\\${names.runPs1}"`,
  ], '\r\n')
}

function renderRun(options: NormalizedWebLauncherOptions): string {
  const cliPath = powershellLiteral(join(options.codeHome, 'apps', 'cli', 'lib', 'bin.js'))
  return lines([
    "$ErrorActionPreference = 'Continue'",
    '',
    `$cliPath = ${cliPath}`,
    `$logPath = Join-Path $env:DSH_HOME 'logs\\web-${String(options.port)}.log'`,
    '$writer = [System.IO.StreamWriter]::new(',
    '    $logPath,',
    '    $false,',
    '    [System.Text.UTF8Encoding]::new($false)',
    ')',
    '$writer.AutoFlush = $true',
    '$exitCode = 1',
    'try {',
    `    & node $cliPath web --no-open --port ${String(options.port)} 2>&1 |`,
    '        ForEach-Object {',
    '            $line = [string]$_',
    '            [Console]::Out.WriteLine($line)',
    '            $writer.WriteLine($line)',
    '        }',
    '    $exitCode = $LASTEXITCODE',
    '} finally {',
    '    $writer.Dispose()',
    '}',
    'exit $exitCode',
  ], '\n')
}

function renderRestartPowerShell(options: NormalizedWebLauncherOptions, names: WebLauncherNames): string {
  const release = options.release
  const port = String(options.port)
  return lines([
    "$ErrorActionPreference = 'Stop'",
    '',
    `$port = ${port}`,
    `$startScript = Join-Path $PSScriptRoot ${powershellLiteral(names.startCmd)}`,
    `$restartScript = Join-Path $PSScriptRoot ${powershellLiteral(names.restartCmd)}`,
    '$currentProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID)',
    '$currentLauncherProcessId = if ($currentProcess) { [int]$currentProcess.ParentProcessId } else { 0 }',
    '$startScriptToken = $startScript.ToLowerInvariant()',
    '$restartScriptToken = $restartScript.ToLowerInvariant()',
    '$startupProcesses = @(',
    '    Get-CimInstance Win32_Process |',
    '        Where-Object {',
    "            $_.Name -ieq 'cmd.exe' -and",
    '            $_.ProcessId -ne $currentLauncherProcessId -and',
    '            $_.CommandLine -and',
    '            ($_.CommandLine.ToLowerInvariant().Contains($startScriptToken) -or',
    '                $_.CommandLine.ToLowerInvariant().Contains($restartScriptToken))',
    '        }',
    ')',
    '',
    'if ($startupProcesses.Count -gt 1) {',
    '    $processIds = ($startupProcesses | Select-Object -ExpandProperty ProcessId) -join ", "',
    `    Write-Error "Refusing to stop port \${port}: found multiple DSH ${release} startup processes (\$processIds)."`,
    '    exit 1',
    '}',
    '',
    'if ($startupProcesses.Count -eq 1) {',
    '    $startupProcessId = [int]$startupProcesses[0].ProcessId',
    `    Write-Host "Stopping DSH ${release} startup tree \$startupProcessId..."`,
    '    & taskkill.exe /PID $startupProcessId /T /F | Out-Null',
    '} else {',
    '    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)',
    '    $processIds = @(',
    '        $listeners |',
    '            Select-Object -ExpandProperty OwningProcess -Unique |',
    '            Where-Object { $_ -and $_ -ne $PID }',
    '    )',
    '    if ($processIds.Count -eq 0) {',
    `        Write-Host "No DSH ${release} Web listener found on port \$port."`,
    '        exit 0',
    '    }',
    '    foreach ($processId in $processIds) {',
    '        Write-Host "Stopping process $processId listening on port $port..."',
    '        & taskkill.exe /PID ([int]$processId) /T /F | Out-Null',
    '    }',
    '}',
    '',
    'Write-Host "Waiting for port $port to close..."',
    '$deadline = (Get-Date).AddSeconds(10)',
    'do {',
    '    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)',
    '    if ($listeners.Count -eq 0) {',
    '        Write-Host "Port $port is free."',
    '        exit 0',
    '    }',
    '    Start-Sleep -Milliseconds 250',
    '} while ((Get-Date) -lt $deadline)',
    '',
    '$remainingProcessIds = @(',
    '    $listeners |',
    '        Select-Object -ExpandProperty OwningProcess -Unique',
    ') -join ", "',
    'Write-Error "Port $port is still listening (PID: $remainingProcessIds)."',
    'exit 1',
  ], '\n')
}

function renderRestartCmd(options: NormalizedWebLauncherOptions, names: WebLauncherNames): string {
  return lines([
    '@echo off',
    'setlocal',
    'set "SCRIPT_DIR=%~dp0"',
    '',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%${names.restartPs1}"`,
    'if errorlevel 1 (',
    `  echo Failed to stop the existing DSH ${options.release} Web process.`,
    '  pause',
    '  exit /b 1',
    ')',
    '',
    `call "%SCRIPT_DIR%${names.startCmd}"`,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'if not "%EXIT_CODE%"=="0" (',
    `  echo DSH ${options.release} Web failed to start. Check "%SCRIPT_DIR%logs\\web-${String(options.port)}.log".`,
    '  pause',
    ')',
    'endlocal & exit /b %EXIT_CODE%',
  ], '\r\n')
}

function renderStopCmd(names: WebLauncherNames): string {
  return lines([
    '@echo off',
    'setlocal',
    'set "SCRIPT_DIR=%~dp0"',
    '',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%${names.restartPs1}"`,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'endlocal & exit /b %EXIT_CODE%',
  ], '\r\n')
}

/**
 * Render the complete launcher set for one isolated Web installation.
 * @param options - data home, code worktree, release label, and port.
 * @returns launcher filenames and their complete contents.
 */
export function renderWebLaunchers(options: WebLauncherOptions): Readonly<Record<string, string>> {
  const normalized = normalizedOptions(options)
  const names = launcherNames(normalized.port)
  return {
    [names.restartCmd]: renderRestartCmd(normalized, names),
    [names.restartPs1]: renderRestartPowerShell(normalized, names),
    [names.runPs1]: renderRun(normalized),
    [names.startCmd]: renderStart(normalized, names),
    [names.stopCmd]: renderStopCmd(names),
  }
}

function launcherDirectory(options: NormalizedWebLauncherOptions): void {
  let stat
  try {
    stat = lstatSync(options.dataHome)
  } catch {
    throw new Error(`dataHome does not exist: ${options.dataHome}`)
  }
  if (!stat.isDirectory()) throw new Error(`dataHome must be a directory: ${options.dataHome}`)
  try {
    stat = lstatSync(options.codeHome)
  } catch {
    throw new Error(`codeHome does not exist: ${options.codeHome}`)
  }
  if (!stat.isDirectory()) throw new Error(`codeHome must be a directory: ${options.codeHome}`)
}

/**
 * Return launcher drift or stale-port errors without changing the data home.
 * @param options - data home, code worktree, release label, and port.
 * @returns one error for each missing, changed, or stale launcher.
 */
export function checkWebLaunchers(options: WebLauncherOptions): readonly string[] {
  const normalized = normalizedOptions(options)
  launcherDirectory(normalized)
  const expected = renderWebLaunchers(normalized)
  const errors: string[] = []
  for (const [name, content] of Object.entries(expected)) {
    const path = join(normalized.dataHome, name)
    if (!existsSync(path)) {
      errors.push(`${name}: launcher is missing`)
      continue
    }
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`${name}: launcher must be a regular file`)
      continue
    }
    if (readFileSync(path, 'utf8') !== content) errors.push(`${name}: launcher differs from the generated target launcher`)
  }
  const expectedPort = String(normalized.port)
  for (const name of readdirSync(normalized.dataHome)) {
    const match = STALE_LAUNCHER_PATTERN.exec(name)
    if (match !== null && match[1] !== expectedPort) errors.push(`${name}: launcher belongs to another port`)
  }
  return errors
}

/**
 * Write the complete launcher set and verify it immediately.
 * @param options - data home, code worktree, release label, and port.
 * @returns nothing; throws when the target description or generated files are invalid.
 */
export function writeWebLaunchers(options: WebLauncherOptions): void {
  const normalized = normalizedOptions(options)
  launcherDirectory(normalized)
  mkdirSync(normalized.dataHome, { recursive: true })
  for (const [name, content] of Object.entries(renderWebLaunchers(normalized))) {
    writeFileSync(join(normalized.dataHome, name), content, 'utf8')
  }
  const errors = checkWebLaunchers(normalized)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

interface CliOptions extends WebLauncherOptions {
  readonly action: 'check' | 'write'
}

function optionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parseCliOptions(argv: readonly string[]): CliOptions | undefined {
  if (argv.includes('--help') || argv.includes('-h')) return undefined
  let dataHome: string | undefined
  let codeHome: string | undefined
  let release: string | undefined
  let port: number | undefined
  let action: CliOptions['action'] | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--data-home') dataHome = optionValue(argv, index++, flag)
    else if (flag === '--code-home') codeHome = optionValue(argv, index++, flag)
    else if (flag === '--release') release = optionValue(argv, index++, flag)
    else if (flag === '--port') {
      const value = optionValue(argv, index++, flag)
      port = Number(value)
      if (!Number.isInteger(port)) throw new Error('--port must be an integer')
    } else if (flag === '--check' || flag === '--write') {
      const nextAction = flag === '--check' ? 'check' : 'write'
      if (action !== undefined && action !== nextAction) throw new Error('--check and --write are mutually exclusive')
      action = nextAction
    } else throw new Error(`unknown option: ${flag}`)
  }
  if (dataHome === undefined || codeHome === undefined || release === undefined || port === undefined || action === undefined) {
    throw new Error('--data-home, --code-home, --release, --port, and one of --check or --write are required')
  }
  return { dataHome, codeHome, release, port, action }
}

function printHelp(): void {
  console.log('Usage: pnpm run upgrade-web-launchers --write|--check --data-home <home> --code-home <worktree> --release <release-label> --port <port>')
  console.log('  --write  Generate all five Windows Web launchers; never removes stale files')
  console.log('  --check  Verify the five generated launchers and reject launchers for another port')
}

function main(): void {
  try {
    const options = parseCliOptions(process.argv.slice(2))
    if (options === undefined) {
      printHelp()
      return
    }
    if (options.action === 'write') {
      writeWebLaunchers(options)
      console.log(`upgrade-web-launchers: wrote and verified port ${String(options.port)}`)
      return
    }
    const errors = checkWebLaunchers(options)
    if (errors.length > 0) {
      for (const error of errors) console.error(`upgrade-web-launchers: ${error}`)
      process.exitCode = 1
      return
    }
    console.log(`upgrade-web-launchers: verified port ${String(options.port)}`)
  } catch (error) {
    console.error(`upgrade-web-launchers: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
