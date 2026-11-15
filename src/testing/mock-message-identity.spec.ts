import 'reflect-metadata'
import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockInteraction } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// Each case follows discord.js 14.27.0, where no call gives an object an earlier one gave. CachedManager#_add(data, false)
// (src/managers/CachedManager.js:46-61) returns a patched clone of a cached message, or a new one, and caches neither.
// Only a gateway MESSAGE_UPDATE patches a cached message in place (src/client/actions/MessageUpdate.js:14).
describe.each([
  ['without strict mocks', false],
  ['under strict mocks', true],
])("a mock interaction's messages, %s", (_mode, strict) => {
  beforeEach(() => {
    forgetStrictMocks()
    forgetDeprecationWarnings()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    if (strict) useStrictMocks()
  })
  afterEach(() => {
    forgetStrictMocks()
    vi.restoreAllMocks()
  })

  const command = async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'status' })
    await interaction.reply({ content: 'a' })
    return interaction
  }

  // fetchReply() reaches Webhook#fetchMessage, which calls messages._add(data, false) (src/structures/Webhook.js:325)
  it('are a new object for each fetchReply(), with the same id', async () => {
    const interaction = await command()

    const first = await interaction.fetchReply()
    const second = await interaction.fetchReply()

    expect(second).not.toBe(first)
    expect(second.id).toBe(first.id)
  })

  // editReply() reaches Webhook#editMessage: a new Message without a cached channel, a message not yet cached added and
  // returned, a cached one cloned (Webhook.js:364-372); a fetched message is a copy outside the cache, so none of these
  it('are a new object for editReply(), not one an earlier fetchReply() gave', async () => {
    const interaction = await command()
    const fetched = await interaction.fetchReply()

    const edited = await interaction.editReply({ content: 'b' })

    expect(edited).not.toBe(fetched)
    expect(edited.id).toBe(fetched.id)
  })

  // The fetch after an edit is Webhook#fetchMessage again (Webhook.js:325), not the edit's object
  it("are a new object for a fetchReply() after an edit, not the edit's result", async () => {
    const interaction = await command()
    const edited = await interaction.editReply({ content: 'b' })

    const fetched = await interaction.fetchReply()

    expect(fetched).not.toBe(edited)
    expect(fetched.id).toBe(edited.id)
    expect(fetched.content).toBe('b')
  })

  // followUp() reaches Webhook#send, which calls messages._add(d, false) (Webhook.js:235); fetching it, Webhook.js:325
  it('are a new object for a follow-up and for fetchReply() of its id', async () => {
    const interaction = await command()
    const followUp = await interaction.followUp({ content: 'more' })

    const fetched = await interaction.fetchReply(followUp.id)

    expect(fetched).not.toBe(followUp)
    expect(fetched.id).toBe(followUp.id)
  })

  // A fetched message is a copy outside the cache (Webhook.js:325), so no edit patches it
  it('keep what a message held from before an edit said, and editedTimestamp tells two edits apart', async () => {
    const interaction = await command()
    const before = await interaction.fetchReply()

    const first = await interaction.editReply({ content: 'b' })
    const second = await interaction.editReply({ content: 'c' })

    expect(before.content).toBe('a')
    expect(before.editedTimestamp).toBeNull()
    expect(first.content).toBe('b')
    expect(second.editedTimestamp!).toBeGreaterThan(first.editedTimestamp!)
  })

  // Fetching the message a component's update() edited is Webhook#fetchMessage too (Webhook.js:325)
  it("are a new object for each fetchReply() after a component's update()", async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'save' })
    await click.update({ content: 'saved' })

    const first = await click.fetchReply()
    const second = await click.fetchReply()

    expect(second).not.toBe(first)
    expect(second.id).toBe(first.id)
  })
})
