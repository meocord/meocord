import { type ControllerOptions } from '@src/interface/index.js'
import { INHERIT_STAGES } from '@src/core/guard-runner.js'
import { guardOwnHandlersWithBaseGuards } from '@src/decorator/guard.decorator.js'
import { makeInjectable } from '@src/util/injectable.util.js'

/**
 * Marks a class as a controller, whose methods handle commands, components, messages, reactions or events.
 *
 * Use it on every class of handlers, and list the class in `@MeoCord({ controllers })`. Logic the handlers
 * share, such as database access, belongs in a service it injects.
 *
 * @remarks
 * A controller's class-level guards, interceptors, filters and cooldowns apply to every handler it declares or
 * inherits, and to every handler of a class that extends it: a handler runs its own class's first, then each
 * base's, then the method's. `inheritStages: false` keeps the handlers a subclass declares to its own stages.
 *
 * @param options - Whether the handlers it declares take the stages of the classes it extends.
 *
 * @example
 * ```ts
 * @Controller()
 * export class ProfileSlashController {
 *   constructor(private readonly profiles: ProfileService) {}
 *
 *   @Command('profile', CommandType.SLASH)
 *   async profile(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send({ embeds: [await this.profiles.render(interaction.user.id)] })
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Controllers
 * @see {@link Command}
 * @see {@link ControllerOptions}
 * @see {@link https://meocord.dev/docs/4.1/how-a-call-runs | How a call runs}
 */
export function Controller(options: ControllerOptions = {}) {
  return function (target: abstract new (...args: any[]) => unknown) {
    makeInjectable(target)
    if (options.inheritStages === false) Reflect.defineMetadata(INHERIT_STAGES, false, target)
    guardOwnHandlersWithBaseGuards(target)
  }
}
