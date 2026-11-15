/**
 * Discord's length and count limits for what a bot sends, in characters as `string.length` counts them.
 *
 * Over a limit, Discord refuses the whole message. {@link splitMessage} and {@link truncate} fit text to these;
 * `route().build()` and `@Command` check customIds against `customId`. Each value is from Discord's message resource
 * and component reference, except `textDisplay`, which Discord's reference leaves open and `@discordjs/builders`
 * enforces.
 *
 * @example
 * ```ts
 * declare const summary: string
 *
 * const embed = new EmbedBuilder().setDescription(truncate(summary, DiscordLimits.embedDescription))
 * ```
 *
 * @group Utilities
 * @see {@link https://meocord.dev/docs/4.2/formatting | Formatting}
 */
export const DiscordLimits = Object.freeze({
  /** A message's `content`. */
  content: 2000,
  /** The embeds one message holds. */
  embeds: 10,
  /** An embed's title. */
  embedTitle: 256,
  /** An embed's description. */
  embedDescription: 4096,
  /** The fields one embed holds. */
  embedFields: 25,
  /** An embed field's name. */
  embedFieldName: 256,
  /** An embed field's value. */
  embedFieldValue: 1024,
  /** An embed footer's text. */
  embedFooterText: 2048,
  /** An embed author's name. */
  embedAuthorName: 256,
  /** Every title, description, field, footer and author name of a message's embeds, summed. */
  embedTotal: 6000,
  /** A component's customId. */
  customId: 100,
  /** A button's label. */
  buttonLabel: 80,
  /** A select menu option's label, value or description, and a radio or checkbox group option's. */
  selectOption: 100,
  /** A text input's value. */
  textInputValue: 4000,
  /** A text display's content. */
  textDisplay: 4000,
} as const)
