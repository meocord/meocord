import {
  type APIModalInteractionResponseCallbackData,
  type ApplicationCommandOptionChoiceData,
  DiscordAPIError,
  type Interaction,
  type InteractionDeferReplyOptions,
  type InteractionDeferUpdateOptions,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type JSONEncodable,
  type LaunchActivityOptions,
  type MessageEditOptions,
  type MessagePayload,
  type MessageResolvable,
  type ModalComponentData,
} from 'discord.js'
import { existingResponse, type ResponseCall, type ResponsePhase } from '@src/common/response/response-state.js'
import { callOrder } from '@src/common/response/call-order.js'
import { RESPONSE_LOG } from '@src/testing/response-log.js'

/**
 * How an interaction was answered, as {@link getResponse} reports it.
 *
 * @group Testing
 * @category Inspection
 */
export interface ResponseReport {
  /** Where the answer stands: `'unanswered'`, `'deferred'` or `'replied'`. */
  state: ResponsePhase

  /** Whether anything the user can see was sent: a reply, an update, an edit or a follow-up that Discord accepted. */
  sent: boolean

  /**
   * Every answer call the interaction got, through `respond()` or discord.js directly, in order: the payload it sent,
   * without `withResponse`, and the `error` of one Discord refused. Checking a call's `method` types its `payload` as
   * that method takes it: the options of a reply, an edit or a deferral, the modal shown, the message deleted, or an
   * autocomplete's choices.
   */
  calls: readonly (
    | (ResponseCall & { method: 'reply' | 'followUp'; payload?: string | MessagePayload | InteractionReplyOptions })
    | (ResponseCall & { method: 'update'; payload?: string | MessagePayload | InteractionUpdateOptions })
    | (ResponseCall & { method: 'editReply'; payload?: string | MessagePayload | InteractionEditReplyOptions })
    | (ResponseCall & { method: 'message.edit'; payload?: string | MessagePayload | MessageEditOptions })
    | (ResponseCall & {
        method: 'showModal'
        payload?: JSONEncodable<APIModalInteractionResponseCallbackData> | ModalComponentData | APIModalInteractionResponseCallbackData
      })
    | (ResponseCall & { method: 'deferReply'; payload?: InteractionDeferReplyOptions })
    | (ResponseCall & { method: 'deferUpdate'; payload?: InteractionDeferUpdateOptions })
    | (ResponseCall & { method: 'deleteReply'; payload?: MessageResolvable | '@original' })
    | (ResponseCall & { method: 'launchActivity'; payload?: Omit<LaunchActivityOptions, 'withResponse'> })
    | (ResponseCall & { method: 'sendPremiumRequired'; payload?: undefined })
    | (ResponseCall & { method: 'respond'; payload?: readonly ApplicationCommandOptionChoiceData[] })
  )[]
}

const VISIBLE = new Set<ResponseCall['method']>(['reply', 'update', 'editReply', 'followUp', 'message.edit'])

/**
 * Reports how an interaction was answered: where its answer stands, and every answer call it got, in order.
 *
 * Use it after `invoke` or `dispatch` to check what the member sees. A mock interaction records each `reply`,
 * `deferReply`, `editReply`, `followUp`, `deleteReply`, `update`, `deferUpdate` and `showModal`, and under
 * `useStrictMocks()` each `launchActivity`, `sendPremiumRequired` and autocomplete `respond` too, whether the handler made
 * it through `respond()` or with discord.js directly, so both are reported, each once. For a message or a reaction, read
 * the mock's own methods.
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
 * @see {@link https://meocord.dev/docs/4.2/invoke-and-dispatch | Invoke and dispatch}
 */
export function getResponse(interaction: Interaction): ResponseReport {
  const state = existingResponse(interaction)
  // A mock records every answer it gets; respond()'s edits through the channel are its own, so they are merged in
  const log = (interaction as { [RESPONSE_LOG]?: readonly ResponseCall[] })[RESPONSE_LOG]
  const viaChannel = state?.history.filter(call => call.method === 'message.edit') ?? []
  const calls = log ? [...log, ...viaChannel].sort((a, b) => callOrder(a) - callOrder(b)) : [...(state?.history ?? [])]
  const sent = calls.some(call => VISIBLE.has(call.method) && !('error' in call))
  // Each call recorded what its method received, as that method takes it
  if (state) return { state: state.state, sent, calls: calls as ResponseReport['calls'] }
  // An autocomplete's choices are its answer, as observers read it, where its mock records them, under strict mocks
  const answered = interaction.isRepliable() ? interaction.replied : Boolean(log) && interaction.isAutocomplete() && interaction.responded
  const deferred = interaction.isRepliable() ? interaction.deferred : false
  return {
    state: answered ? 'replied' : deferred ? 'deferred' : 'unanswered',
    sent: log ? sent : answered,
    calls: calls as ResponseReport['calls'],
  }
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
