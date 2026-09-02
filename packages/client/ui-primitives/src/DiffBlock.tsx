import { diffLines, diffWords } from 'diff'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { FoldToggle } from './FoldToggle.tsx'
import { writeClipboard } from './clipboard.ts'
import css from './DiffBlock.module.css'

/** Default diff-content line cap before context folding. */
export const DEFAULT_DIFF_MAX_LINES = 16

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
  /** Height cap in content lines before context ranges collapse (default
   * {@link DEFAULT_DIFF_MAX_LINES}); path and hunk-gap rows do not consume it.
   */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/** Localized chrome for {@link DiffBlock}. */
export interface DiffBlockLabels {
  copy: string
  copied: string
  collapseAria: string
  expandAria: (hidden: number) => string
  collapse: string
  expand: (hidden: number) => string
  files: (count: number) => string
}

type DiffRowKind = 'path' | 'context' | 'del' | 'add' | 'gap'

interface DiffSegment {
  text: string
  changed: boolean
}

/** A single rendered body line and its role, so folding can protect changes. */
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

interface DiffFoldRange {
  start: number
  end: number
  hidden: number
}

type DiffDisplayItem =
  | { kind: 'row'; index: number; row: DiffRow }
  | { kind: 'fold'; range: DiffFoldRange }

interface DiffChangeUnit {
  indices: number[]
  center: number
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

function pushPlainRows(rows: DiffRow[], kind: 'del' | 'add' | 'context', lines: string[], start: number | undefined): void {
  lines.forEach((text, index) => {
    rows.push(makeRow(kind, text, start === undefined ? undefined : start + index))
  })
}

/**
 * Reconstruct semantic context/change rows from one hunk. `FileDiff` stores
 * before/after text rather than row markers, so the browser repeats the line
 * diff here and can keep unchanged context neutral.
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

    pushPlainRows(rows, 'context', currentLines, oldLine ?? newLine)
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
 * metadata is intentionally excluded from the footer and collapsed-row stat.
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

function isContentRow(row: DiffRow): boolean {
  return row.kind !== 'path' && row.kind !== 'gap'
}

function isChangeRow(row: DiffRow): boolean {
  return row.kind === 'del' || row.kind === 'add'
}

/** Hide outer context first, leaving rows near the changed blocks visible. */
function selectContextRows(rows: DiffRow[], count: number): number[] {
  const contexts = rows.flatMap((row, index) => row.kind === 'context' ? [index] : [])
  const fromStart = Math.ceil(count / 2)
  const fromEnd = count - fromStart
  return [
    ...contexts.slice(0, fromStart),
    ...contexts.slice(contexts.length - fromEnd),
  ].sort((left, right) => left - right)
}

function buildChangeUnits(rows: DiffRow[]): DiffChangeUnit[] {
  const blocks: Array<{ start: number; end: number; hasRemoved: boolean; hasAdded: boolean }> = []
  let block: { start: number; end: number; hasRemoved: boolean; hasAdded: boolean } | undefined
  for (const [index, row] of rows.entries()) {
    if (!isChangeRow(row)) {
      block = undefined
      continue
    }
    if (block === undefined) {
      block = { start: index, end: index + 1, hasRemoved: row.kind === 'del', hasAdded: row.kind === 'add' }
      blocks.push(block)
    } else {
      block.end = index + 1
      block.hasRemoved ||= row.kind === 'del'
      block.hasAdded ||= row.kind === 'add'
    }
  }

  const units: DiffChangeUnit[] = []
  for (const current of blocks) {
    const indices = Array.from({ length: current.end - current.start }, (_value, offset) => current.start + offset)
    if (current.hasRemoved && current.hasAdded) {
      units.push({ indices, center: (current.start + current.end - 1) / 2 })
      continue
    }
    for (const index of indices) units.push({ indices: [index], center: index })
  }
  return units
}

function selectChangeRows(rows: DiffRow[], count: number): number[] {
  const units = buildChangeUnits(rows)
  const midpoint = rows.length / 2
  units.sort((left, right) => {
    const leftDistance = Math.abs(left.center - midpoint)
    const rightDistance = Math.abs(right.center - midpoint)
    if (leftDistance !== rightDistance) return leftDistance - rightDistance
    return left.center - right.center
  })
  const selected: number[] = []
  let remaining = count
  for (const unit of units) {
    if (unit.indices.length > remaining) continue
    selected.push(...unit.indices)
    remaining -= unit.indices.length
    if (remaining === 0) break
  }
  return selected.sort((left, right) => left - right)
}

function buildFoldRanges(indices: number[]): DiffFoldRange[] {
  const ranges: DiffFoldRange[] = []
  for (const index of [...indices].sort((left, right) => left - right)) {
    const previous = ranges[ranges.length - 1]
    if (previous !== undefined && previous.end === index) {
      previous.end += 1
      previous.hidden += 1
    } else {
      ranges.push({ start: index, end: index + 1, hidden: 1 })
    }
  }
  return ranges
}

/**
 * Select rows to fold without spending the cap on file headers. Context rows
 * are lower priority than changes; a replacement block is selected as one
 * unit when dense changes leave no room for every changed row.
 * @param rows - the flattened diff rows.
 * @param maxLines - the collapsed content-row cap.
 * @returns the ranges to fold.
 */
function buildDiffFoldPlan(rows: DiffRow[], maxLines: number): DiffFoldRange[] {
  const contentRows = rows.filter(isContentRow)
  const hiddenBudget = contentRows.length - maxLines
  if (hiddenBudget <= 0) return []

  const contextRows = rows.flatMap((row, index) => row.kind === 'context' ? [index] : [])
  const hiddenRows = contextRows.length >= hiddenBudget
    ? selectContextRows(rows, hiddenBudget)
    : [...contextRows, ...selectChangeRows(rows, hiddenBudget - contextRows.length)]
  return buildFoldRanges(hiddenRows)
}

function buildDisplayItems(rows: DiffRow[], ranges: DiffFoldRange[], expanded: ReadonlySet<number>): DiffDisplayItem[] {
  const rangesByStart = new Map(ranges.map(range => [range.start, range]))
  const items: DiffDisplayItem[] = []
  let skipUntil = 0
  for (const [index, row] of rows.entries()) {
    if (index < skipUntil) continue
    const range = rangesByStart.get(index)
    if (range === undefined) {
      items.push({ kind: 'row', index, row })
      continue
    }
    if (expanded.has(range.start)) {
      for (const [offset, expandedRow] of rows.slice(range.start, range.end).entries()) {
        items.push({ kind: 'row', index: range.start + offset, row: expandedRow })
      }
    }
    items.push({ kind: 'fold', range })
    skipUntil = range.end
  }
  return items
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className }: DiffBlockProps) {
  const { rows, added, removed, files, lineNumberWidth } = useMemo(() => buildRows(diffs), [diffs])
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(() => new Set())
  const [copied, setCopied] = useState(false)
  const foldRanges = useMemo(() => buildDiffFoldPlan(rows, maxLines), [rows, maxLines])
  const displayItems = useMemo(() => buildDisplayItems(rows, foldRanges, expandedFolds), [rows, foldRanges, expandedFolds])

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback((start: number) => {
    setExpandedFolds((current) => {
      const next = new Set(current)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })
  }, [])

  if (rows.length === 0) return null

  const numbered = lineNumberWidth > 0
  return (
    <div className={clsx(css.block, className)} data-diff="">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      <div className={css.body}>
        {displayItems.map((item) => {
          if (item.kind === 'fold') {
            const expanded = expandedFolds.has(item.range.start)
            return (
              <FoldToggle
                key={`fold-${item.range.start}`}
                className={css.expand}
                expanded={expanded}
                hidden={item.range.hidden}
                labels={labels}
                onToggle={() => { onToggle(item.range.start) }}
              />
            )
          }
          const { row } = item
          return (
            <div
              key={`row-${item.index}`}
              className={clsx(css.line, ROW_CLASS[row.kind], numbered && css.numbered)}
              data-diff-line={row.kind}
            >
              {renderRow(row, lineNumberWidth)}
            </div>
          )
        })}
      </div>
      <div className={css.footer}>└ +{added} -{removed} · {labels.files(files)}</div>
    </div>
  )
}
