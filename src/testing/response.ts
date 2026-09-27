import { DiscordAPIError, type Interaction } from 'discord.js'
import { existingResponse, type ResponseCall, type ResponsePhase } from '@src/common/response/response-state.js'

/**
 * What `respond()` did for an interaction, as {@link getResponse} reports it.
 *
 * @group Testing
 * @category Inspection
 */
export interface ResponseReport {
  /** Where the answer stands: `'unanswered'`, `'deferred'` or `'replied'`. */
  state: ResponsePhase

  /** Whether anything the user can see was sent: a reply, an update, an edit or a follow-up that Discord accepted. */
  sent: boolean

  /** Every Discord call made through `respond()`, in order, with the payload it sent, and the `error` of one Discord refused. */
  calls: readonly ResponseCall[]
}

const VISIBLE = new Set<ResponseCall['method']>(['reply', 'update', 'editReply', 'followUp', 'message.edit'])

/**
 * Reports what `respond()` did for an interaction: where its answer stands, and each Discord call it made.
 *
 * Use it after `invoke` or `dispatch` to check what the member sees. An interaction `respond()` was never used for
 * reports what discord.js shows on it, with no calls; for a message or a reaction, read the mock's own methods.
 *
 * @param interaction - The interaction a handler answered.
 * @returns The state, whether anything the member can see was sent, and the calls, in order.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * @Controller()
 * class RefreshController {
 *   @Command('refresh', CommandType.BUTTON)
 *   @Defer()
 *   async refresh(interaction: ButtonInteraction) {
 *     await respond(interaction).send('Refreshed.')
 *   }
 * }
 * const module = MeoCordTestingModule.create({ controllers: [RefreshController] }).compile()
 * const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh' })
 * await module.invoke(RefreshController, 'refresh', interaction)
 * expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferUpdate', 'editReply'])
 * ```
 *
 * @group Testing
 * @category Inspection
 * @see {@link TestingModule}
 * @see {@link https://meocord.dev/docs/4.1/invoke-and-dispatch | Invoke and dispatch}
 */
export function getResponse(interaction: Interaction): ResponseReport {
  const state = existingResponse(interaction)
  if (state) {
    const calls = [...state.history]
    return { state: state.state, sent: calls.some(call => VISIBLE.has(call.method) && !('error' in call)), calls }
  }
  const answered = interaction.isRepliable() ? interaction.replied : false
  const deferred = interaction.isRepliable() ? interaction.deferred : false
  return { state: answered ? 'replied' : deferred ? 'deferred' : 'unanswered', sent: answered, calls: [] }
}

/**
 * Creates the error discord.js throws for a failed Discord API call, for a mock to reject with.
 *
 * Use it to test what a handler or `respond()` does when Discord refuses a call. Common codes: 10062, the three
 * seconds to answer passed; 40060, already acknowledged; 50001, missing access; 50027, the fifteen-minute token
 * expired.
 *
 * @param code - The Discord JSON error code.
 * @param message - The error's message; one naming the code by default.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
 * interaction.reply.mockRejectedValueOnce(createDiscordError(10062))
 *
 * // respond() passes Discord's refusal on to the handler, and a filter or the fallback answers it
 * await expect(respond(interaction).send('Pong!')).rejects.toMatchObject({ code: 10062 })
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link getResponse}
 */
export function createDiscordError(code: number, message = `Discord API error ${code}`): DiscordAPIError {
  return new DiscordAPIError({ code, message }, code, 400, 'POST', 'https://discord.com/api/v10/interactions', {})
}
