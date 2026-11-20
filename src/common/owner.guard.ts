import 'reflect-metadata'
import { type MessageComponentInteraction, type ModalSubmitInteraction } from 'discord.js'
import { GuardDeniedError } from '@src/common/errors.js'
import { textFor } from '@src/common/meocord-text.js'
import { Guard } from '@src/decorator/guard.decorator.js'
import { type GuardInterface } from '@src/interface/index.js'
import { META } from '@src/util/metadata-keys.js'

/** The customId param {@link OwnerGuard} compares with the user when its params name none. */
export const OWNER_PARAM = 'ownerId'

/**
 * Lets only the user whose id a component's customId carries use it.
 *
 * Use it on a button, select menu or modal opened for one user, such as a confirmation, a paginator or a settings
 * card, whose route carries that user's id: `card/{ownerId:snowflake}`. Anyone else who clicks is told privately that
 * it is not theirs, and the handler does not run. On a select menu, their pick is also put back, so the menu shows
 * what it did before they picked.
 *
 * @remarks
 * It denies by throwing `GuardDeniedError`, so the fallback answers in the user's language, with
 * `meocord.guard.notOwner` from the app's catalogs, and a filter that catches `GuardDeniedError` can answer otherwise.
 * Its params name another route param, `param`, and give the app's own words, `message`. MeoCord refuses it at
 * startup where it would deny every call: on a slash command, a context menu or an entry point, and on a component or
 * modal whose routes lack the param. Written on a message, reaction, autocomplete or event handler, it is refused too;
 * on a controller or in `@MeoCord({ guards })`, it passes over those handlers, which it never runs for.
 *
 * @example
 * ```ts
 * @Command('card/{ownerId:snowflake}', CommandType.BUTTON)
 * @UseGuard(OwnerGuard)
 * async card(interaction: ButtonInteraction) {
 *   await respond(interaction).send('Your card.')
 * }
 *
 * @Command('poll/{pollId}/{authorId:snowflake}', CommandType.BUTTON)
 * @UseGuard({ provide: OwnerGuard, params: { param: 'authorId', message: 'Only the author can close this poll.' } })
 * async close(interaction: ButtonInteraction) {
 *   await respond(interaction).send('Poll closed.')
 * }
 * ```
 *
 * @pipeline guards where `@UseGuard` applies it
 * @group Utilities
 * @category Pipeline stages
 * @see {@link UseGuard}
 * @see {@link GuardDeniedError}
 * @see {@link https://meocord.dev/docs/4.3/guards | Guards}
 */
@Guard({ types: ['interaction'] })
export class OwnerGuard implements GuardInterface {
  /** `param`, the route param holding the owner's id, `ownerId` unless given; `message`, what anyone else is told. */
  declare readonly params?: { param?: string; message?: string }

  /**
   * Lets the call through when the user who clicked or submitted is the one the route param names.
   *
   * @param interaction - The component or modal interaction.
   * @param route - The params read from its customId.
   * @returns `true` for the owner.
   * @throws GuardDeniedError for anyone else.
   */
  canActivate(interaction: MessageComponentInteraction | ModalSubmitInteraction, route?: Readonly<Record<string, unknown>>): boolean {
    const owner = route?.[this.params?.param ?? OWNER_PARAM]
    if (owner !== undefined && String(owner) === interaction.user.id) return true
    throw new GuardDeniedError(this.params?.message ?? textFor(interaction, { key: 'meocord.guard.notOwner' }))
  }
}

// Kept on the class, not its subclasses, and read by either build of this version
Reflect.defineMetadata(META.ownerGuard, true, OwnerGuard)
