// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FileOpenTargetRow, type FileOpenTargetRowProps } from '../src/client/settings/FileOpenTargetRow.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', subagentsByParent: {}, jobsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

describe('FileOpenTargetRow', () => {
  it('shows the Host default and selects Sidebar preview', () => {
    const source = createSnapshotStore<'host' | 'sidebar'>('host')
    const setFileOpenTarget = vi.fn((next: 'host' | 'sidebar') => { source.set(next) })
    const props: FileOpenTargetRowProps = {
      usePanelInfo: selector => selector({ activePanelId: null }),
      useSessions: emptySessions(),
      useSessionStatus: noPendingInteraction(),
      useWorkspaces: emptyWorkspaces(),
      useSessionRetainInfo: () => undefined,
      useResource,
      useFileOpenTarget: bindSnapshotSelector(source),
      setFileOpenTarget,
      t: makeTranslate(en),
    }
    render(<FileOpenTargetRow {...props} />)

    expect(screen.getByText('File opening location')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Default application/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sidebar preview' }))
    expect(setFileOpenTarget).toHaveBeenCalledWith('sidebar')
    expect(screen.getByRole('button', { name: /Sidebar preview/ })).toBeDefined()
  })
})
