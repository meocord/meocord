import { describe, expectTypeOf, it } from 'vitest'
import { type APIMessageTopLevelComponent, type ButtonInteraction, type Message, MessageFlags } from 'discord.js'
import { respond, type ResponseState } from '@src/common/index.js'

/**
 * Runs under `vitest --typecheck`. The negative cases use `@ts-expect-error`,
 * which fails once the rejected form starts compiling.
 */

declare const interaction: ButtonInteraction

describe('respond()', () => {
  it('sends text, or reply options with the flags a new message can take', () => {
    expectTypeOf(respond(interaction).send('Done')).resolves.toEqualTypeOf<Message | undefined>()
    void respond(interaction).send({ content: 'Only you', flags: MessageFlags.Ephemeral })
    void respond(interaction).followUp({ content: 'Quiet', flags: [MessageFlags.SuppressNotifications, MessageFlags.Ephemeral] })
    void respond(interaction).send({ components: [], flags: MessageFlags.IsComponentsV2 })
  })

  it("hands the original message's components back to send and editReply, as it does its embeds", () => {
    const state = respond(interaction)
    const original = state.original
    if (original) {
      void state.send({ components: original.components, embeds: original.embeds })
      void interaction.editReply({ components: original.components })
      expectTypeOf(original.components).toEqualTypeOf<readonly APIMessageTopLevelComponent[]>()
    }
  })

  it('refuses a flag Discord sets itself, and the withResponse option respond() manages', () => {
    // @ts-expect-error Crossposted is set by Discord, never sent
    void respond(interaction).send({ content: 'x', flags: MessageFlags.Crossposted })
    // @ts-expect-error withResponse is managed by respond()
    void respond(interaction).send({ content: 'x', withResponse: true })
  })

  it('still takes the deprecated ephemeral option, read as the Ephemeral flag', () => {
    void respond(interaction).send({ content: 'x', ephemeral: true })
    void respond(interaction).followUp({ content: 'x', ephemeral: false })
    // @ts-expect-error ephemeral is a boolean
    void respond(interaction).send({ content: 'x', ephemeral: 'yes' })
  })

  it('takes { fill } as a second argument to send, edit and followUp', () => {
    void respond(interaction).send({ embeds: [] }, { fill: false })
    void respond(interaction).edit('x', { fill: true })
    void respond(interaction).followUp('x', {})
    // @ts-expect-error fill is a boolean
    void respond(interaction).send('x', { fill: 'no' })
  })

  it('refuses making an existing message ephemeral with edit()', () => {
    void respond(interaction).edit({ content: 'x', flags: MessageFlags.SuppressEmbeds })
    // @ts-expect-error an edit cannot change who sees the message
    void respond(interaction).edit({ content: 'x', flags: MessageFlags.Ephemeral })
  })

  it('takes only the documented error visibilities and acknowledge options', () => {
    void respond(interaction).error(new Error('x'), { message: 'Nope', visibility: 'private' })
    // @ts-expect-error visibility is 'reply' or 'private'
    void respond(interaction).error(new Error('x'), { visibility: 'public' })
    // @ts-expect-error acknowledge takes only ephemeral
    void respond(interaction).acknowledge({ ephemeral: true, fetchReply: true })
  })
})

describe('ResponseState', () => {
  it('offers the calls a handler answers with, and nothing the framework keeps to itself', () => {
    expectTypeOf(respond(interaction)).toEqualTypeOf<ResponseState>()
    expectTypeOf<keyof ResponseState>().toEqualTypeOf<
      'location' | 'state' | 'message' | 'original' | 'acknowledge' | 'lock' | 'send' | 'edit' | 'followUp' | 'delete' | 'modal' | 'error'
    >()
  })
})
