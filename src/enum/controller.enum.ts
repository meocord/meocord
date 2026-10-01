export enum ControllerType {
  BUTTON = 'button',
  MODAL_SUBMIT = 'modal-submit',
  SELECT_MENU = 'select-menu',
  USER_SELECT_MENU = 'user-select-menu',
  ROLE_SELECT_MENU = 'role-select-menu',
  MENTIONABLE_SELECT_MENU = 'mentionable-select-menu',
  CHANNEL_SELECT_MENU = 'channel-select-menu',
  REACTION = 'reaction',
  MESSAGE = 'message',
  SLASH = 'slash',
  AUTOCOMPLETE = 'autocomplete',
  CONTEXT_MENU = 'context-menu',
  PRIMARY_ENTRY_POINT = 'primary-entry-point',
}

/**
 * The kind of interaction a `@Command` handles, such as a slash command or a button.
 *
 * Pass it to `@Command` with the command's name or the component's customId pattern. Each member is one Discord
 * interaction type, so the handler's parameter type follows from it; entity select menus are separate members
 * for that reason.
 *
 * @example
 * ```ts
 * @Command('profile/{uid}', CommandType.BUTTON)
 * async profile(interaction: ButtonInteraction, { uid }: { uid: string }) {
 *   await respond(interaction).send(`Profile of <@${uid}>`)
 * }
 * ```
 *
 * @group Types
 * @see {@link Command}
 */
export enum CommandType {
  /** Chat input command, or one subcommand of it. */
  SLASH = 'SLASH',
  /** User or message context menu command, the handler typed with the kind its builder's `setType()` names. */
  CONTEXT_MENU = 'CONTEXT_MENU',
  /** Activity launch command (`ApplicationCommandType.PrimaryEntryPoint`). */
  PRIMARY_ENTRY_POINT = 'PRIMARY_ENTRY_POINT',
  /** Button, routed by its customId pattern. */
  BUTTON = 'BUTTON',
  /** String select menu — the one whose options the application defines itself. */
  SELECT_MENU = 'SELECT_MENU',
  /** User select menu. */
  USER_SELECT_MENU = 'USER_SELECT_MENU',
  /** Role select menu. */
  ROLE_SELECT_MENU = 'ROLE_SELECT_MENU',
  /** Mentionable select menu, of users and roles. */
  MENTIONABLE_SELECT_MENU = 'MENTIONABLE_SELECT_MENU',
  /** Channel select menu. */
  CHANNEL_SELECT_MENU = 'CHANNEL_SELECT_MENU',
  /** Modal submission, routed by its customId pattern. */
  MODAL_SUBMIT = 'MODAL_SUBMIT',
}

/**
 * Whether a `@ReactionHandler` call is for a reaction added to a message or removed from it.
 *
 * Read it from the handler's second argument when the handler should act on one only, such as counting a vote
 * when it is added and taking it back when it is removed.
 *
 * @example
 * ```ts
 * @ReactionHandler('👍')
 * async vote(reaction: MessageReaction, { action }: ReactionEvent) {
 *   const change = action === ReactionHandlerAction.ADD ? 'counted' : 'taken back'
 *   await reaction.message.reply(`Vote ${change}.`)
 * }
 * ```
 *
 * @group Types
 * @see {@link ReactionHandler}
 */
export enum ReactionHandlerAction {
  /** Reaction added to a message. */
  ADD = 'ADD',
  /** Reaction removed from a message. */
  REMOVE = 'REMOVE',
}
