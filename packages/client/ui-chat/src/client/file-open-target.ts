/** Host-backed Chat file-opening target policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_FILE_OPEN_TARGET, FILE_OPEN_TARGET_FIELD,
  type ChatSettings, type FileOpenTarget,
} from '../chat-settings.ts'

/** Live file-opening preference consumed by Chat and its Settings row. */
export class FileOpenTargetPolicy {
  /** Reactive current target; defaults to the Host application before settings arrive. */
  readonly target: SnapshotStore<FileOpenTarget> = createSnapshotStore(DEFAULT_FILE_OPEN_TARGET)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param target - Host default application or Sidebar preview.
   */
  setTarget(target: FileOpenTarget): void {
    if (this.target.getSnapshot() === target) return
    this.target.set(target)
    void this.host.set(FILE_OPEN_TARGET_FIELD, target)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    if (this.target.getSnapshot() === section.fileOpenTarget) return
    this.target.set(section.fileOpenTarget)
  }
}
