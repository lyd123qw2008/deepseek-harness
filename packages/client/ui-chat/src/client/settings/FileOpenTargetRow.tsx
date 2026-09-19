/** General Settings row for Chat file-opening targets. */

import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileOpenTarget } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import css from './TranscriptViewRow.module.css'

/** Registration-side file-opening preference face. */
export interface FileOpenTargetRowInjected {
  hooks: {
    /** Persisted file-opening preference bound as useFileOpenTarget. */
    fileOpenTarget: SnapshotStore<FileOpenTarget>
  }
  /** Change the Chat file-opening target. */
  setFileOpenTarget: (target: FileOpenTarget) => void
}

/** Full Settings-row props. */
export type FileOpenTargetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<FileOpenTargetRowInjected>

const OPTIONS: readonly { id: FileOpenTarget; label: ChatKey }[] = [
  { id: 'host', label: 'settings.fileOpenTarget.host' },
  { id: 'sidebar', label: 'settings.fileOpenTarget.sidebar' },
]

/**
 * Render the Chat file-opening target selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function FileOpenTargetRow({ useFileOpenTarget, setFileOpenTarget, t }: FileOpenTargetRowProps) {
  const target = useFileOpenTarget(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = target === 'sidebar'
    ? 'settings.fileOpenTarget.sidebar'
    : 'settings.fileOpenTarget.host'
  const closeMenu = () => { setOpen(false) }
  const selectTarget = (id: string) => {
    closeMenu()
    setFileOpenTarget(id as FileOpenTarget)
  }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(selectedLabel)}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.fileOpenTarget.title')}</div>
        <div className={css.desc}>{t('settings.fileOpenTarget.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={target}
        onSelect={selectTarget}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
