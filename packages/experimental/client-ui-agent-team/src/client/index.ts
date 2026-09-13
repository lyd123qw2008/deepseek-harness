/** Browser entry binding the generated Team Remote artifact to its Client UI. */

import agentTeamsRemote from '@deepseek-ai/dsh-experimental-agent-team/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mountAgentTeamUi } from './mount.ts'

export { inject } from './mount.ts'
export type { TeamActionInjected, TeamActionProps, TeamActionResult } from './TeamAction.tsx'
export type { TeamKey } from './locales.ts'

/** Browser-side Team UI configuration. */
export interface Config {
  /**
   * Presets allowed to display the Team action. When omitted, preset ids
   * beginning with `team-` are accepted; an explicit empty list allows every
   * preset for legacy embedders.
   */
  enabledPresets?: string[]
}

/** Validated browser-side Team UI configuration. */
export const Config: z<Config> = z.object({
  enabledPresets: z.array(z.string()).default(['team-local', 'team-pragmatic-local']),
})

/** Mount the generated Team Remote contribution and its browser UI. */
export async function apply(ctx: ClientContext, config: Config = {}): Promise<() => Promise<void>> {
  // Static browser plugin activation does not carry Host Loader row config, so
  // the omitted default must still keep ordinary presets Team-free.
  return await mountAgentTeamUi(ctx, agentTeamsRemote, config.enabledPresets)
}
