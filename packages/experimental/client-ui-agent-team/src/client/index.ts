/** Browser entry registering the Agent Teams conversation-header action. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerAgentTeamUi } from './mount.ts'

export { inject } from './mount.ts'
export type { TeamActionInjected, TeamActionProps } from './TeamAction.tsx'
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

/**
 * Register the Team locale dictionaries and header action on the Client Context.
 * @param ctx - Client Context with the declared `inject` services available.
 * @param config - optional preset allowlist for the visible Team action.
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  // Static browser plugin activation does not carry Host Loader row config, so
  // the omitted default must still keep ordinary presets Team-free.
  registerAgentTeamUi(ctx, config.enabledPresets)
}
