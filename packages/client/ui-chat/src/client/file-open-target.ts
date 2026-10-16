/** Chat file-opening target preference with process-local choices on memory-only settings scopes. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_FILE_OPEN_TARGET, type ChatSettings, type FileOpenTarget } from '../chat-settings.ts'

/** Shared live target for the settings row and every Chat file action. */
export class FileOpenTargetPolicy {
  private readonly unsubscribe: () => void
  /** Current target, reconciled with accepted Host settings when available. */
  readonly target = createSnapshotStore<FileOpenTarget>(DEFAULT_FILE_OPEN_TARGET)

  /** @param host - Chat settings scope, durable on loopback and memory-only elsewhere. */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const adopt = (): void => {
      const accepted = host.getSnapshot().value?.fileOpenTarget
      if (accepted !== undefined) this.target.set(accepted)
    }
    this.unsubscribe = host.subscribe(adopt)
    adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish a choice immediately and persist it when the scope supports writes.
   * @param target - Host default application or Sidebar preview.
   */
  setTarget(target: FileOpenTarget): void {
    if (target === this.target.getSnapshot()) return
    this.target.set(target)
    void this.host.set('fileOpenTarget', target)
  }
}
