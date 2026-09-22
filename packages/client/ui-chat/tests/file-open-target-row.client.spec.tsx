// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { FileOpenTarget } from '../src/chat-settings.ts'
import { FileOpenTargetRow, type FileOpenTargetRowProps } from '../src/client/settings/FileOpenTargetRow.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

// The resource hook the resources plugin merges into GlobalStandardProps; this row reads no address.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

function mount(target: FileOpenTarget = 'host', dictionary: typeof en | typeof zh = en) {
  const source = createSnapshotStore<FileOpenTarget>(target)
  const setFileOpenTarget = vi.fn((next: FileOpenTarget) => { source.set(next) })
  const props: FileOpenTargetRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useSessionRetainInfo: () => undefined,
    useResource,
    useFileOpenTarget: bindSnapshotSelector(source),
    setFileOpenTarget,
    t: makeTranslate(dictionary),
  }
  render(<FileOpenTargetRow {...props} />)
  return { setFileOpenTarget, props }
}

describe('FileOpenTargetRow', () => {
  it('explains the preference and shows the Host application by default', () => {
    mount()
    expect(screen.getByText('File opening location')).toBeDefined()
    expect(screen.getByText('Controls file links and tool-path actions in Chat')).toBeDefined()
    expect(screen.getByRole('button', { name: /Default application/ })).toBeDefined()
  })

  it('selects the Sidebar target from the menu', () => {
    const { setFileOpenTarget } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Default application/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sidebar preview' }))
    expect(setFileOpenTarget).toHaveBeenCalledWith('sidebar')
  })

  it('renders the Sidebar choice already selected and localizes the row', () => {
    mount('sidebar', zh)
    expect(screen.getByText('文件打开位置')).toBeDefined()
    expect(screen.getByRole('button', { name: /侧边栏预览/ })).toBeDefined()
  })
})
