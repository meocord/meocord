import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, MessageFlagsBitField } from 'discord.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction, createMockMessage, getResponse } from '@src/testing/index.js'

const { Ephemeral } = MessageFlags

const command = () => createMockInteraction(ChatInputCommandInteraction)
/** A button on a message with these flags. */
const button = (flags = 0) => {
  const message = Object.assign(createMockMessage(), { flags: new MessageFlagsBitField(flags) })
  return createMockInteraction(ButtonInteraction, { customId: 'refresh', message: message as never })
}
const methods = (interaction: object) => getResponse(interaction as never).calls.map(call => (call.error ? `${call.method}!` : call.method))
const payload = (interaction: object, at = -1) => getResponse(interaction as never).calls.at(at)?.payload as Record<string, unknown>
const ephemeral = (flags: unknown) => new MessageFlagsBitField(flags as number).has(Ephemeral)

// Discord refuses a fetch, edit or delete of a deleted original response with 10008, as the mock does
describe('an answer deleted with delete()', () => {
  it.each(['send', 'edit'] as const)('is followed by %s() as a follow-up, which is the answer from then on', async method => {
    const interaction = command()
    const state = respond(interaction)
    await state.send('one')
    await state.delete()

    const sent = await state[method]('two')
    expect(state.message).toBe(sent)
    await state.send('three')
    await state.delete()

    expect(methods(interaction)).toEqual(['reply', 'deleteReply', 'followUp', 'editReply', 'deleteReply'])
    expect(payload(interaction, -2)).toMatchObject({ content: 'three', message: sent!.id })
    expect(payload(interaction)).toBe(sent!.id)
  })

  it("leaves no message until something is sent, not even the component's deleted one", async () => {
    const interaction = button()
    await respond(interaction).acknowledge()

    await respond(interaction).delete()

    expect(respond(interaction).message).toBeUndefined()
  })

  it('refuses a second delete() with nothing sent since', async () => {
    const interaction = command()
    await respond(interaction).send('one')
    await respond(interaction).delete()

    await expect(respond(interaction).delete()).rejects.toThrow('There is no answer to delete: it was deleted.')
    expect(methods(interaction)).toEqual(['reply', 'deleteReply'])
  })

  it.each([
    ['a private answer, privately', Ephemeral, undefined, true],
    ['a public answer, publicly', 0, undefined, false],
    ['a private answer, as its own flags ask', Ephemeral, 0, false],
  ])('sends the next answer after %s', async (_, answered, asked, private_) => {
    const interaction = command()
    await respond(interaction).send({ content: 'one', flags: answered })
    await respond(interaction).delete()

    await respond(interaction).send({ content: 'two', ...(asked !== undefined && { flags: asked }) })

    expect(methods(interaction).at(-1)).toBe('followUp')
    expect(ephemeral(payload(interaction).flags)).toBe(private_)
  })

  it('makes a follow-up the answer that send() then edits', async () => {
    const interaction = command()
    await respond(interaction).send('one')
    await respond(interaction).delete()

    const followed = await respond(interaction).followUp('two')
    await respond(interaction).send('three')

    expect(methods(interaction)).toEqual(['reply', 'deleteReply', 'followUp', 'editReply'])
    expect(payload(interaction)).toMatchObject({ message: followed!.id })
  })

  it('answers an error after it with a private follow-up, which is the answer', async () => {
    const interaction = command()
    await respond(interaction).send('one')
    await respond(interaction).delete()

    await respond(interaction).error(new Error('broke'))

    expect(methods(interaction)).toEqual(['reply', 'deleteReply', 'followUp'])
    expect(ephemeral(payload(interaction).flags)).toBe(true)
    expect(respond(interaction).message).toBeDefined()
  })

  // A private message is where a component's error is added, while it is there
  it("follows a component's deleted private message with an error of its own, never adding it there", async () => {
    const interaction = button(Ephemeral)
    await respond(interaction).acknowledge()
    await respond(interaction).delete()

    await respond(interaction).error(new Error('broke'))

    expect(methods(interaction)).toEqual(['deferUpdate', 'deleteReply', 'followUp'])
  })
})

describe('a private follow-up that replaced a public deferral', () => {
  it('is the answer send(), edit() and delete() act on, by its id', async () => {
    const interaction = command()
    await interaction.deferReply()
    const state = respond(interaction)
    const followed = await state.followUp({ content: 'Only you see this.', flags: Ephemeral })

    await state.send('Updated.')
    await state.edit('Again.')
    expect(state.message?.id).toBe(followed!.id)
    await state.delete()

    expect(methods(interaction)).toEqual(['deferReply', 'deleteReply', 'followUp', 'editReply', 'editReply', 'deleteReply'])
    expect(payload(interaction, -3)).toMatchObject({ content: 'Updated.', message: followed!.id })
    expect(payload(interaction)).toBe(followed!.id)
  })
})
