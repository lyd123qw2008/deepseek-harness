// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { DEFAULT_DIFF_MAX_LINES, DiffBlock as LocalizedDiffBlock, diffTotals, type DiffHunk } from '../src/index.ts'
import { diffBlockLabels } from './labels.client.ts'

function DiffBlock(props: Omit<ComponentProps<typeof LocalizedDiffBlock>, 'labels'>) {
  return <LocalizedDiffBlock {...props} labels={diffBlockLabels} />
}

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

function bodyRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_line_"]')].map(row => row.textContent ?? '')
}

function changeRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-diff-line="del"], [data-diff-line="add"]')].map(row => (
    row.querySelector('[class*="_lineContent_"]')?.textContent ?? ''
  ))
}

function added(count: number): string {
  return Array.from({ length: count }, (_v, i) => `line ${i + 1}`).join('\n')
}

describe('DiffBlock structure', () => {
  it('renders a create as a path header and an added block (no removed side)', () => {
    const diffs: DiffHunk[] = [{ path: 'notes/new.txt', oldText: null, newText: 'hello\nworld' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('notes/new.txt')).toBeTruthy()
    // No removed rows: both change lines are added.
    expect(changeRows(container)).toEqual(['hello', 'world'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(0)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(2)
  })

  it('renders an edit as a removed block above an added block', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'old', newText: 'new' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
    expect(changeRows(container)).toEqual(['old', 'new'])
  })

  it('keeps context neutral and renders old/new line numbers for an applied hunk', () => {
    const { container } = render(<DiffBlock diffs={[{
      path: 'dsh-page-demo.md',
      oldText: 'header\n- 状态：旧内容\n目的',
      newText: 'header\n- 状态：新内容\n目的',
      oldStart: 5,
      newStart: 5,
    }]} />)
    const rows = [...container.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['path', 'context', 'del', 'add', 'context'])
    expect(rows.map(row => row.querySelector('[class*="_lineNumber_"]')?.textContent ?? '')).toEqual(['', '5', '6', '6', '7'])
    expect(rows[1]?.className).toContain('_context_')
    expect(rows[1]?.className).not.toContain('_del_')
    expect(rows[1]?.className).not.toContain('_add_')
    expect(rows[2]?.querySelectorAll('mark').length).toBe(1)
    expect(rows[3]?.querySelectorAll('mark').length).toBe(1)
  })

  it('renders a backwards-compatible diff without a line-number gutter', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} />)
    expect(container.querySelectorAll('[class*="_lineNumber_"]').length).toBe(0)
    expect(container.querySelectorAll('[class*="_marker_"]').length).toBe(2)
  })

  it('keeps indentation outside inline highlights and uses plain rows for multi-line changes', () => {
    const { container } = render(<DiffBlock diffs={[
      { path: 'indent.ts', oldText: '  old', newText: '  new' },
      { path: 'spaces.ts', oldText: '   ', newText: 'x' },
      { path: 'multi.ts', oldText: 'old one\nold two', newText: 'new one\nnew two\nnew three' },
    ]} />)
    const firstChanged = container.querySelector('[data-diff-line="del"] [class*="_lineContent_"]')
    expect(firstChanged?.querySelector('mark')?.textContent).toBe('old')
    expect(firstChanged?.textContent).toBe('  old')
    // The two single-line edits yield three marks: indentation-only whitespace
    // is not marked, and the multi-line replacement stays at line granularity.
    expect(container.querySelectorAll('[data-diff-line="del"] mark, [data-diff-line="add"] mark').length).toBe(3)
  })

  it('ignores invalid starts and leaves a missing side number blank', () => {
    const { container } = render(<DiffBlock diffs={[
      { path: 'invalid.ts', oldText: 'old', newText: 'new', oldStart: 0, newStart: Number.NaN },
      { path: 'partial.ts', oldText: 'old', newText: 'new', oldStart: 8 },
    ]} />)
    const addedRows = [...container.querySelectorAll('[data-diff-line="add"]')]
    expect(addedRows.map(row => row.querySelector('[class*="_lineNumber_"]')?.textContent ?? '')).toEqual([' ', ' '])
    expect(container.querySelectorAll('[class*="_lineNumber_"]').length).toBe(4)
  })

  it('opens a same-file second hunk with a gap instead of repeating the path', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    // One path header, one gap row.
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(1)
  })

  it('opens a new file with its own path header', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'b.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(2)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(0)
  })

  it('renders nothing for empty diffs', () => {
    const { container } = render(<DiffBlock diffs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('treats a trailing newline as a terminator, not an extra blank line', () => {
    // A create whose newText ends in a newline is one added line, not two, and
    // the footer counts one — the phantom `+ ` empty line the naive split drew.
    const { container } = render(<DiffBlock diffs={[{ path: 'n.txt', oldText: null, newText: 'hello\n' }]} />)
    expect(changeRows(container)).toEqual(['hello'])
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('renders a full deletion as removed-only with no phantom added line', () => {
    // newText '' is zero added lines: an empty string must contribute nothing.
    const { container } = render(<DiffBlock diffs={[{ path: 'gone.ts', oldText: 'a\nb', newText: '' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -2 · 1 file')).toBeTruthy()
  })

  it('keeps a genuine interior blank line', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x\n\ny' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(3)
  })
})

describe('DiffBlock footer', () => {
  it('exports changed-line totals without counting context', () => {
    expect(diffTotals([
      { path: 'a.ts', oldText: 'before\nold\nafter', newText: 'before\nnew\nafter' },
      { path: 'b.ts', oldText: null, newText: 'one\ntwo' },
      { path: 'c.ts', oldText: 'gone\nfile', newText: '' },
    ])).toEqual({ added: 3, removed: 3 })
  })

  it('counts changed lines rather than contextual lines', () => {
    const diffs: DiffHunk[] = [{
      path: 'a.ts',
      oldText: 'context before\nold\ncontext after',
      newText: 'context before\nnew\ncontext after',
    }]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +1 -1 · 1 file')).toBeTruthy()
  })

  it('pluralizes the distinct-file count', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: null, newText: 'x' },
      { path: 'b.ts', oldText: null, newText: 'y' },
    ]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +2 -0 · 2 files')).toBeTruthy()
  })
})

describe('DiffBlock height cap', () => {
  it('does not fold a replacement at the content cap', () => {
    const { container } = render(<DiffBlock diffs={[{
      path: 'a.ts',
      oldText: 'before one\nbefore two\nbefore three\nold\nafter one\nafter two\nafter three',
      newText: 'before one\nbefore two\nbefore three\nnew\nafter one\nafter two\nafter three',
    }]} maxLines={8} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
    expect(changeRows(container)).toEqual(['old', 'new'])
    expect(bodyRows(container)).toHaveLength(9)
  })

  it('folds context instead of hiding a changed row', () => {
    const { container } = render(<DiffBlock diffs={[{
      path: 'a.ts',
      oldText: 'before one\nbefore two\nbefore three\nbefore four\nold\nafter one\nafter two\nafter three',
      newText: 'before one\nbefore two\nbefore three\nbefore four\nnew\nafter one\nafter two\nafter three',
    }]} maxLines={8} />)
    const toggle = screen.getByRole('button', { name: '展开其余 1 行差异' })
    expect(changeRows(container)).toEqual(['old', 'new'])
    expect(bodyRows(container)).toHaveLength(9)
    fireEvent.click(toggle)
    expect(changeRows(container)).toEqual(['old', 'new'])
    expect(bodyRows(container)).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: '收起差异' }))
    expect(bodyRows(container)).toHaveLength(9)
  })

  it('keeps a replacement pair together when the cap cannot fit both rows', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} maxLines={1} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
    expect(changeRows(container)).toEqual(['old', 'new'])
  })

  it('folds separated context ranges without hiding changes', () => {
    const { container } = render(<DiffBlock diffs={[
      { path: 'a.ts', oldText: 'before one\nold one\nafter one', newText: 'before one\nnew one\nafter one' },
      { path: 'a.ts', oldText: 'before two\nold two\nafter two', newText: 'before two\nnew two\nafter two' },
    ]} maxLines={6} />)
    const expandToggles = screen.getAllByRole('button', { name: '展开其余 1 行差异' })
    expect(expandToggles).toHaveLength(2)
    expect(changeRows(container)).toEqual(['old one', 'new one', 'old two', 'new two'])
    const firstToggle = expandToggles.at(0)
    if (firstToggle !== undefined) fireEvent.click(firstToggle)
    expect(screen.getByRole('button', { name: '收起差异' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开其余 1 行差异' })).toBeTruthy()
    expect(changeRows(container)).toEqual(['old one', 'new one', 'old two', 'new two'])
  })

  it('keeps a multi-line replacement block together when it exceeds the cap', () => {
    const { container } = render(<DiffBlock diffs={[{
      path: 'a.ts', oldText: 'old one\nold two', newText: 'new one\nnew two',
    }]} maxLines={2} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
    expect(changeRows(container)).toEqual(['old one', 'old two', 'new one', 'new two'])
  })

  it('shows a dense diff with an expand control past the cap, then all lines expanded', () => {
    // Two added lines over the default content cap force the collapse.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(DEFAULT_DIFF_MAX_LINES + 2), oldStart: 1, newStart: 1 }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    const toggle = screen.getByRole('button', { name: /展开其余/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // The path header is structural and does not consume the content budget.
    const collapsedCount = changeRows(container).length
    expect(collapsedCount).toBe(DEFAULT_DIFF_MAX_LINES)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起差异' }).getAttribute('aria-expanded')).toBe('true')
    expect(changeRows(container).length).toBe(DEFAULT_DIFF_MAX_LINES + 2)
    expect(bodyRows(container).length).toBeGreaterThan(collapsedCount)
  })

  it('shows no expand control at or under the cap', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(4) }]
    render(<DiffBlock diffs={diffs} maxLines={16} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
  })
})

describe('DiffBlock copy', () => {
  it('copies context and change markers without display-only line numbers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{
      path: 'a.ts', oldText: 'before\nold\nafter', newText: 'before\nnew\nafter', oldStart: 4, newStart: 4,
    }]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    expect(writeText).toHaveBeenCalledWith('a.ts\n  before\n- old\n+ new\n  after')
  })

  it('copies the prefixed diff text and flips the label on success', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    render(<DiffBlock diffs={diffs} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    // Path header, del/add prefixes, and the same-file gap all reach the clipboard.
    expect(writeText).toHaveBeenCalledWith('a.ts\n- old\n+ new\n⋯\n- p\n+ q')
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('keeps the label on a refused clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('ignores a second click while the copied label is showing', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制成功' })) })
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
