import 'reflect-metadata'
import { deferMisuseError, type DeferOptions, nonInteractionHandler } from '@src/core/defer.js'
import { refuse, refuseOnClass, declaring } from '@src/util/refusal.util.js'
import { META } from '@src/util/metadata-keys.js'

/**
 * Acknowledges an interaction for its handler, then locks a component's message while the handler runs.
 *
 * Use it on a handler that may take longer than Discord's three seconds, such as one that queries a database
 * or an API. For a handler that shows a modal, which must be the first answer, leave it out.
 *
 * @remarks
 * First, before the guards, it defers, at once or, with `mode: 'auto'`, once `after` passes unanswered: a reply
 * for a command, an invisible update for a component. Then, once the guards, validation and pipes allow the call, it disables the component's
 * controls, shows the loading emoji on the clicked button and adds the presenter's loading view. Answering
 * with `respond(interaction).send()` without `components` puts the message back; a guard that denies the call
 * leaves nothing behind.
 *
 * @param options - Whether the reply is private, what to disable, and whether to acknowledge at once.
 * @throws Error on a message, reaction, event or autocomplete handler: as the decorator applies when it is written
 *   above the handler's decorator, and as the app is created otherwise.
 *
 * @example
 * ```ts
 * constructor(private readonly profiles: ProfileService) {}
 *
 * @Command('refresh/{uid}', CommandType.BUTTON)
 * @Defer()
 * async refresh(interaction: ButtonInteraction, { uid }: { uid: string }) {
 *   await respond(interaction).send({ embeds: [await this.profiles.render(uid)] })
 * }
 * ```
 *
 * @pipeline defer before the guards, acknowledging the interaction
 * @pipeline defer-lock after the cooldowns count the call, just before the handler
 * @group Decorators
 * @category Pipeline stages
 * @see {@link DeferOptions}
 * @see {@link respond}
 * @see {@link https://meocord.dev/docs/4.1/defer | Deferring}
 */
export function Defer(options: DeferOptions = {}): MethodDecorator {
  return declaring((target: object, propertyKey: string | symbol) => {
    refuseOnClass('@Defer', target, propertyKey)
    const methodName = String(propertyKey)
    const kind = nonInteractionHandler(target, methodName)
    if (kind) throw refuse(deferMisuseError(target.constructor.name, methodName, kind))
    Reflect.defineMetadata(META.deferOptions, { ...options }, target, methodName)
  })
}
