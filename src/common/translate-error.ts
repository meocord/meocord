import { BaseInteraction, type Interaction, type Locale, Message } from 'discord.js'
import {
  CommandNotFoundError,
  CooldownError,
  cooldownText,
  CooldownStoreError,
  GuardDeniedError,
  MessageUsageError,
  usageHeading,
  UserError,
  ValidationError,
} from '@src/common/errors.js'
import { interactionLocale, messageLocale, renderText, type TextLocale, textOfIssue } from '@src/common/meocord-text.js'
import { type Translator } from '@src/common/translator.js'

/** What MeoCord tells a user for an error, in a locale, through a translator; English without one. */
export function errorText(error: unknown, translator: Translator<any> | undefined, locale: TextLocale): string {
  const render = (key: string) => renderText(translator, locale, { key })
  if (error instanceof MessageUsageError) {
    const issues = error.issues.map(issue => {
      const text = textOfIssue(issue)
      return text ? renderText(translator, locale, text) : issue.message
    })
    if (error.serverOnly || error.dmOnly) return issues.join('\n')
    return [renderText(translator, locale, usageHeading(error.usage)), ...issues].join('\n')
  }
  if (error instanceof CooldownError) return renderText(translator, locale, cooldownText(error.retryAt))
  if (error instanceof CooldownStoreError) return render('meocord.cooldown.storeDown')
  if (error instanceof CommandNotFoundError) return render('meocord.fallback.notFound')
  if (error instanceof UserError || error instanceof GuardDeniedError || error instanceof ValidationError) return error.message
  return render('meocord.fallback.error')
}

/**
 * The text MeoCord's fallback answers an error with, in a user's or a server's language.
 *
 * Use it in an exception filter that answers MeoCord's errors its own way but keeps their words: a usage error's
 * usage and issues, a cooldown's wait, the cooldown store's refusal, "Command not found!". A guard's, a validation's
 * or a `UserError`'s message is the app's and is returned as it is; any other error is the fallback's generic fault.
 *
 * @remarks
 * Each text comes from the translator's catalogs down the locale's chain, then MeoCord's English: see
 * {@link MeoCordMessages}. An interaction is answered in its user's locale; a message in its server's preferred
 * locale, or, in a DM, the translator's default.
 *
 * @param error - What the call threw.
 * @param t - The app's translator, made by `createTranslator`.
 * @param target - The interaction or message being answered, or a locale.
 * @returns The text, in the target's language where the catalogs have it.
 *
 * @example
 * ```ts
 * @Catch(CooldownError)
 * export class CooldownFilter implements ExceptionFilter<CooldownError> {
 *   constructor(private readonly t: Translator) {}
 *
 *   async catch(error: CooldownError, context: ExecutionContext) {
 *     const interaction = context.getInteraction()
 *     if (interaction?.isRepliable()) {
 *       await interaction.reply({ content: `⏳ ${translateError(error, this.t, interaction)}`, flags: MessageFlags.Ephemeral })
 *     }
 *   }
 * }
 * ```
 *
 * @group Utilities
 * @category Localisation
 * @see {@link createTranslator}
 * @see {@link https://meocord.dev/docs/4.1/localisation | Localisation}
 */
export function translateError(error: unknown, t: Translator<any>, target: Interaction | Message | Locale | `${Locale}`): string {
  const locale =
    target instanceof BaseInteraction ? interactionLocale(target) : target instanceof Message ? messageLocale(target) : (target as TextLocale)
  return errorText(error, t, locale)
}
