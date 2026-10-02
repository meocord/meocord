import 'reflect-metadata'
import { type ClientEvents } from 'discord.js'
import { ownHandlerList } from '@src/decorator/controller.decorator.js'
import { META } from '@src/util/metadata-keys.js'
import { refuseOnClass } from '@src/util/refusal.util.js'

/** One `@On` or `@Once` declaration: the event, the method handling it, and whether it runs only once. */
export interface EventHandlerMetadata {
  event: keyof ClientEvents
  method: string
  once: boolean
}

function eventDecorator<E extends keyof ClientEvents>(event: E, once: boolean) {
  // Generic over the method, so it is checked against the event's arguments rather than required to match exactly
  return function <F extends (...args: ClientEvents[E]) => unknown>(
    target: object,
    propertyKey: string,
    _descriptor: TypedPropertyDescriptor<F>,
  ) {
    refuseOnClass(once ? '@Once' : '@On', target, propertyKey)
    const handlers = ownHandlerList<EventHandlerMetadata>(META.eventHandlers, target)
    handlers.push({ event, method: propertyKey, once })
    Reflect.defineMetadata(META.eventHandlers, handlers, target)
  }
}

/**
 * Handles a discord.js client event every time it is emitted, on a controller or a service.
 *
 * Use it for gateway events MeoCord has no handler type for, such as a member joining or a channel being
 * created. For commands, components, messages and reactions, use {@link Command}, `@MessageHandler` or
 * `@ReactionHandler`, which route them.
 *
 * @remarks
 * The handler's parameters are typed from discord.js's `ClientEvents`. It runs through the pipeline, so the app's
 * global guards apply to it, and its class's and its own, and an error it throws is logged without stopping the bot. Handling `interactionCreate`
 * or `messageCreate` here runs alongside MeoCord's own dispatch of them.
 *
 * @param event - The client event to handle, such as `'guildMemberAdd'`.
 *
 * @example
 * ```ts
 * @On('guildMemberAdd')
 * async greet(member: GuildMember) {
 *   await member.send(`Welcome to ${member.guild.name}!`)
 * }
 * ```
 *
 * @pipeline handler with the guards, interceptors and filters that apply to events: the app's global ones, its class's and its own
 * @group Decorators
 * @category Handlers
 * @see {@link Once}
 * @see {@link https://meocord.dev/docs/4.1/gateway-events | Gateway events}
 */
export function On<E extends keyof ClientEvents>(event: E) {
  return eventDecorator(event, false)
}

/**
 * Handles a discord.js client event the first time it is emitted only, on a controller or a service.
 *
 * Use it for one-off work on an event, such as warming a cache once the client is ready. For every emission,
 * use {@link On}; for work at startup and shutdown, a service's `onReady` and `onShutdown` hooks.
 *
 * @param event - The client event to handle, such as `'clientReady'`.
 *
 * @example
 * ```ts
 * @Service()
 * export class CacheWarmer {
 *   @Once('clientReady')
 *   async warm(client: Client<true>) {
 *     await client.guilds.fetch()
 *   }
 * }
 * ```
 *
 * @pipeline handler with the guards, interceptors and filters that apply to events: the app's global ones, its class's and its own
 * @group Decorators
 * @category Handlers
 * @see {@link On}
 * @see {@link https://meocord.dev/docs/4.1/gateway-events | Gateway events}
 */
export function Once<E extends keyof ClientEvents>(event: E) {
  return eventDecorator(event, true)
}

/**
 * The `@On` and `@Once` handlers declared on a class, inherited ones included.
 *
 * @param target - The class's prototype.
 * @returns The declarations, in the order they were made.
 */
export function getEventHandlers(target: object): EventHandlerMetadata[] {
  return Reflect.getMetadata(META.eventHandlers, target) ?? []
}
