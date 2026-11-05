/** General Settings row for the Chat file-opening target. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileOpenTarget } from '../../chat-settings.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side file-opening preference. */
export interface FileOpenTargetRowInjected {
  hooks: {
    /** Current target, bound as useFileOpenTarget. */
    fileOpenTarget: ObservableSnapshot<FileOpenTarget>
  }
  /** Change the target used by Chat file links and tool-path actions. */
  setFileOpenTarget: (target: FileOpenTarget) => void
}

/** Full Settings-row props. */
export type FileOpenTargetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<FileOpenTargetRowInjected>

/**
 * Render the file-opening target selector.
 * @param props - Composed Settings slot props.
 * @returns The preference row.
 */
export function FileOpenTargetRow({ useFileOpenTarget, setFileOpenTarget, t }: FileOpenTargetRowProps) {
  const target = useFileOpenTarget(value => value)
  return (
    <PreferenceRow
      title={t('settings.fileOpenTarget.title')}
      description={t('settings.fileOpenTarget.description')}
      value={target}
      selectedLabel={t(target === 'sidebar' ? 'settings.fileOpenTarget.sidebar' : 'settings.fileOpenTarget.host')}
      options={[
        { id: 'host', label: t('settings.fileOpenTarget.host') },
        { id: 'sidebar', label: t('settings.fileOpenTarget.sidebar') },
      ]}
      onSelect={(value) => { setFileOpenTarget(value as FileOpenTarget) }}
    />
  )
}
