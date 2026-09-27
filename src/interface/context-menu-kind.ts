import {
  type ApplicationCommandType,
  type ContextMenuCommandType,
  type MessageContextMenuCommandInteraction,
  type UserContextMenuCommandInteraction,
} from 'discord.js'

// The kind is kept under a key of its own, for the compiler alone. A string key, so an app emitting declarations can
// name it; not the builder's own `type`, whose enum may come from another copy of discord-api-types than the app's.
declare module 'discord.js' {
  interface ContextMenuCommandBuilder {
    /**
     * Sets whether this is a user or a message context menu command.
     *
     * With MeoCord, the builder also remembers the kind for the compiler, so a `@Command` handler of this builder
     * receives `UserContextMenuCommandInteraction` or `MessageContextMenuCommandInteraction`, and one declaring the
     * other kind fails to compile. Nothing changes at runtime. Leave `build()`'s return type to be inferred: written
     * out as `ContextMenuCommandBuilder`, it drops the kind, and the handler is checked only as the bot starts.
     *
     * @param type - `ApplicationCommandType.User` or `ApplicationCommandType.Message`.
     */
    setType<Kind extends ContextMenuCommandType>(type: Kind): this & { readonly '~meocordContextMenuKind'?: Kind }
  }
}

/** Either context menu interaction, for a builder whose kind the compiler cannot tell. */
type AnyContextMenuInteraction = UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction

/**
 * The interaction a context menu handler receives, from the kind its builder's `setType()` was given: either one
 * when it was given none, or a kind only known at runtime. `NonNullable`, since a declaration file writes the
 * optional kind with `| undefined`.
 */
export type ContextMenuInteractionOf<Built> = Built extends { readonly '~meocordContextMenuKind'?: infer Kind }
  ? [NonNullable<Kind>] extends [never]
    ? AnyContextMenuInteraction
    : [NonNullable<Kind>] extends [ApplicationCommandType.User]
      ? UserContextMenuCommandInteraction
      : [NonNullable<Kind>] extends [ApplicationCommandType.Message]
        ? MessageContextMenuCommandInteraction
        : AnyContextMenuInteraction
  : AnyContextMenuInteraction
