import { type ExecutionContext } from 'meocord/common'
import { Observer } from 'meocord/decorator'
import { type DispatchObserver, type DispatchResult } from 'meocord/interface'
import { report } from '@src/report'

/** What a call was: a command by its name, a component or modal by its customId, or the handler a message ran. */
function whatOf(context: ExecutionContext): string {
  const interaction = context.getInteraction()
  if (interaction?.isCommand()) return `/${interaction.commandName}`
  if (interaction && 'customId' in interaction) return interaction.customId
  return context.getHandlerName() ?? context.getType()
}

/**
 * Reports who made each call of the manual checklist, so scripts/e2e.ts can tell the person working through it
 * from anyone else who reaches the globally registered commands.
 */
@Observer({ types: ['interaction', 'message'] })
export class ActorObserver implements DispatchObserver {
  onSettled(context: ExecutionContext, { outcome }: DispatchResult) {
    const user = context.getInteraction()?.user ?? context.getMessage()?.author
    if (user) report('actor', { user: user.id, what: whatOf(context), outcome })
  }
}
