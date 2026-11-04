import { diffLines, diffWords } from 'diff'
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import css from './DiffBlock.module.css'

/** Default diff body viewport height in content-line units before vertical scrolling. */
export const DEFAULT_DIFF_MAX_LINES = 10

/**
 * One file change in the form {@link DiffBlock} renders. It is declared here
 * so this primitive stays independent of the tool contract.
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
  /** Optional 1-based line where this hunk starts in the old file. Older call-time and session data may omit it. */
  oldStart?: number
  /** Optional 1-based line where this hunk starts in the new file. Older call-time and session data may omit it. */
  newStart?: number
}

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: DiffHunk[]
  /** Localized chrome supplied by the owning render site. */
  labels: DiffBlockLabels
  /** Approximate visible content-line height before the body scrolls vertically.
   * The default is {@link DEFAULT_DIFF_MAX_LINES}; `Infinity` disables the cap.
   */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** Localized chrome for {@link DiffBlock}. */
export interface DiffBlockLabels {
  copy: string
  copied: string
  files: (count: number) => string
}

type DiffRowKind = 'path' | 'context' | 'del' | 'add' | 'gap'

interface DiffSegment {
  text: string
  changed: boolean
}

/** A single rendered body line and its role. */
interface DiffRow {
  kind: DiffRowKind
  text: string
  lineNumber?: number
  segments?: DiffSegment[]
}

interface HunkRows {
  rows: DiffRow[]
  added: number
  removed: number
}

interface DiffRows {
  rows: DiffRow[]
  added: number
  removed: number
  files: number
  lineNumberWidth: number
}

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/** The dim or change class per row kind. */
const ROW_CLASS: Record<DiffRowKind, string | undefined> = {
  path: css.path,
  context: css.context,
  del: css.del,
  add: css.add,
  gap: css.gap,
}

/**
 * Split a side's text into content lines. Empty text is zero lines, and a
 * single trailing newline is a line terminator rather than an extra empty line.
 * @param text - the removed, added, or diff-part text.
 * @returns content lines without the terminating newline.
 */
function contentLines(text: string): string[] {
  /* v8 ignore next -- diffLines omits empty change parts; empty source has no part to split */
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

function advanceLine(line: number | undefined, count: number): number | undefined {
  return line === undefined ? undefined : line + count
}

function lineNumber(line: number | undefined): number | undefined {
  return line !== undefined && Number.isSafeInteger(line) && line >= 1 ? line : undefined
}

function appendSegment(target: DiffSegment[], text: string, changed: boolean, stripLeadingWhitespace: boolean): void {
  let value = text
  if (changed && stripLeadingWhitespace) {
    const firstNonWhitespace = value.search(/\S/)
    const leadingWhitespaceEnd = firstNonWhitespace === -1 ? value.length : firstNonWhitespace
    const leadingWhitespace = value.slice(0, leadingWhitespaceEnd)
    if (leadingWhitespace !== '') target.push({ text: leadingWhitespace, changed: false })
    value = value.slice(leadingWhitespace.length)
  }
  if (value !== '') target.push({ text: value, changed })
}

/**
 * Compute word-level segments for a one-line replacement. Leading indentation
 * stays unhighlighted, matching the line-level gutter's role as the change cue.
 * @param oldText - one removed line.
 * @param newText - one added line.
 * @returns segments for the removed and added render rows.
 */
function inlineSegments(oldText: string, newText: string): { old: DiffSegment[]; new: DiffSegment[] } {
  const old: DiffSegment[] = []
  const added: DiffSegment[] = []
  let firstRemoved = true
  let firstAdded = true
  for (const part of diffWords(oldText, newText)) {
    if (part.removed) {
      appendSegment(old, part.value, true, firstRemoved)
      firstRemoved = false
    } else if (part.added) {
      appendSegment(added, part.value, true, firstAdded)
      firstAdded = false
    } else {
      appendSegment(old, part.value, false, false)
      appendSegment(added, part.value, false, false)
    }
  }
  return { old, new: added }
}

function makeRow(kind: DiffRowKind, text: string, start: number | undefined, segments?: DiffSegment[]): DiffRow {
  const row: DiffRow = { kind, text }
  if (start !== undefined) row.lineNumber = start
  if (segments !== undefined) row.segments = segments
  return row
}

function pushPlainRows(rows: DiffRow[], kind: 'del' | 'add', lines: string[], start: number | undefined): void {
  lines.forEach((text, index) => {
    rows.push(makeRow(kind, text, start === undefined ? undefined : start + index))
  })
}

/** Keep one line from one unchanged segment, choosing the line nearest its change. */
function pushContextPreview(rows: DiffRow[], lines: string[], start: number | undefined, fromEnd: boolean): void {
  const offset = fromEnd ? lines.length - 1 : 0
  const text = lines[offset]
  if (text === undefined) return
  rows.push(makeRow('context', text, start === undefined ? undefined : start + offset))
}

/**
 * Reconstruct semantic context/change rows from one hunk. `FileDiff` stores
 * before/after text rather than row markers, so the browser repeats the line
 * diff here and can keep unchanged context neutral. Each unchanged segment
 * contributes one preview line; all changed rows remain available through scroll.
 * @param diff - one file hunk.
 * @returns rows and changed-line counts for the hunk.
 */
function buildHunkRows(diff: DiffHunk): HunkRows {
  const rows: DiffRow[] = []
  const parts = diffLines(diff.oldText ?? '', diff.newText)
  let oldLine = lineNumber(diff.oldStart)
  let newLine = lineNumber(diff.newStart)
  let added = 0
  let removed = 0

  let skipNext = false
  for (const [index, part] of parts.entries()) {
    if (skipNext) {
      skipNext = false
      continue
    }
    const currentLines = contentLines(part.value)
    if (part.removed) {
      const next = parts[index + 1]
      const addedLines = next?.added === true ? contentLines(next.value) : []
      if (addedLines.length > 0) {
        if (currentLines.length === 1 && addedLines.length === 1) {
          const oldText = currentLines.join('')
          const newText = addedLines.join('')
          const segments = inlineSegments(oldText, newText)
          rows.push(makeRow('del', oldText, oldLine, segments.old))
          rows.push(makeRow('add', newText, newLine, segments.new))
        } else {
          pushPlainRows(rows, 'del', currentLines, oldLine)
          pushPlainRows(rows, 'add', addedLines, newLine)
        }
        removed += currentLines.length
        added += addedLines.length
        oldLine = advanceLine(oldLine, currentLines.length)
        newLine = advanceLine(newLine, addedLines.length)
        skipNext = true
      } else {
        pushPlainRows(rows, 'del', currentLines, oldLine)
        removed += currentLines.length
        oldLine = advanceLine(oldLine, currentLines.length)
      }
      continue
    }
    if (part.added) {
      pushPlainRows(rows, 'add', currentLines, newLine)
      added += currentLines.length
      newLine = advanceLine(newLine, currentLines.length)
      continue
    }

    const nextIsChange = parts[index + 1]?.removed === true || parts[index + 1]?.added === true
    pushContextPreview(rows, currentLines, oldLine ?? newLine, nextIsChange)
    oldLine = advanceLine(oldLine, currentLines.length)
    newLine = advanceLine(newLine, currentLines.length)
  }
  return { rows, added, removed }
}

function hunkChangeCounts(diff: DiffHunk): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of diffLines(diff.oldText ?? '', diff.newText)) {
    const count = contentLines(part.value).length
    if (part.added) added += count
    else if (part.removed) removed += count
  }
  return { added, removed }
}

/**
 * Count only changed lines across hunks. Context stored in applied result
 * metadata is intentionally excluded from the footer totals.
 * @param diffs - the hunks to count.
 * @returns the +/- totals.
 */
export function diffTotals(diffs: DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    const counts = hunkChangeCounts(diff)
    added += counts.added
    removed += counts.removed
  }
  return { added, removed }
}

/**
 * Flatten the hunks into body rows plus footer counts. A path header opens each
 * new file; a same-file second hunk opens with a `⋯` gap. Context rows stay
 * neutral, while removed and added rows get separate markers and line numbers
 * when the optional hunk starts are available.
 * @param diffs - the hunks to render.
 * @returns the body rows, +/- totals, distinct-file count, and gutter width.
 */
function buildRows(diffs: DiffHunk[]): DiffRows {
  const rows: DiffRow[] = []
  const paths = new Set<string>()
  let prevPath: string | undefined
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    paths.add(diff.path)
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    prevPath = diff.path
    const hunk = buildHunkRows(diff)
    rows.push(...hunk.rows)
    added += hunk.added
    removed += hunk.removed
  }
  const maxLine = rows.reduce((max, row) => Math.max(max, row.lineNumber ?? 0), 0)
  return {
    rows,
    added,
    removed,
    files: paths.size,
    lineNumberWidth: maxLine === 0 ? 0 : String(maxLine).length,
  }
}

/**
 * The diff text a reader copies. Gutter numbers are display-only; semantic
 * context and change markers remain in the copied unified-style text.
 * @param rows - the flattened body rows.
 * @returns the diff as plain text.
 */
function copyText(rows: DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'context': return `  ${row.text}`
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'path': return row.text
      case 'gap': return row.text
      /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
      default: return assertNever(row.kind)
    }
  }).join('\n')
}

function renderSegments(row: DiffRow): ReactNode {
  if (row.segments === undefined) return row.text
  return row.segments.map((segment, index) => segment.changed
    ? <mark key={index} className={css.inlineChanged}>{segment.text}</mark>
    : <span key={index}>{segment.text}</span>)
}

function markerFor(kind: 'context' | 'del' | 'add'): string {
  switch (kind) {
    case 'context': return ' '
    case 'del': return '-'
    case 'add': return '+'
    /* v8 ignore next -- closed-union backstop; only reached if a marker kind is forged */
    default: return assertNever(kind)
  }
}

function renderRow(row: DiffRow, lineNumberWidth: number): ReactNode {
  if (row.kind === 'path' || row.kind === 'gap') return row.text
  const number = lineNumberWidth === 0
    ? null
    : <span className={css.lineNumber}>{row.lineNumber === undefined ? ''.padStart(lineNumberWidth) : String(row.lineNumber).padStart(lineNumberWidth)}</span>
  return (
    <>
      <span className={css.marker} aria-hidden="true">{markerFor(row.kind)}</span>
      {number}
      <span className={css.lineContent}>{renderSegments(row)}</span>
    </>
  )
}

/** Maximum body height for a line-based viewport, or undefined for an uncapped body. */
function bodyStyle(maxLines: number): CSSProperties | undefined {
  if (!Number.isFinite(maxLines)) return undefined
  const lines = Math.max(1, maxLines)
  return { maxHeight: `calc(var(--dsl-diff-line-height) * ${lines} + 24px)` }
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className }: DiffBlockProps) {
  const { rows, added, removed, files, lineNumberWidth } = useMemo(() => buildRows(diffs), [diffs])
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  if (rows.length === 0) return null

  const numbered = lineNumberWidth > 0
  return (
    <div className={clsx(css.block, className)} data-diff="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      <div className={css.body} style={bodyStyle(maxLines)}>
        {rows.map((row, index) => (
          <div
            key={`row-${index}`}
            className={clsx(css.line, ROW_CLASS[row.kind], numbered && css.numbered)}
            data-diff-line={row.kind}
          >
            {renderRow(row, lineNumberWidth)}
          </div>
        ))}
      </div>
      <div className={css.footer}>└ +{added} -{removed} · {labels.files(files)}</div>
    </div>
  )
}
