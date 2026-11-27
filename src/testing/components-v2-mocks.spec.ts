import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction, createMockMessage, UNDEFINED_ANSWER_WARNING } from '@src/testing/mock-interaction.js'
import { getResponse } from '@src/testing/response.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2, SuppressEmbeds } = MessageFlags

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void (String(text) === UNDEFINED_ANSWER_WARNING || warned.push(String(text))))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const command = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const text = (content = 'Done') => new TextDisplayBuilder().setContent(content)
const embed = () => new EmbedBuilder().setDescription('card')
const flagsOf = (message: { flags: { toArray(): string[] } }) => message.flags.toArray().sort()
const INVALID_BODY = { code: 50035, status: 400 }

describe('Components V2 edits under useStrictMocks(), as Discord makes them', () => {
  beforeEach(() => useStrictMocks())

  it('keeps a private deferral private when an edit makes it Components V2', async () => {
    const interaction = command()
    await interaction.deferReply({ flags: Ephemeral })

    const message = await interaction.editReply({ components: [text()], flags: IsComponentsV2 })

    expect([message.flags.has(Ephemeral), interaction.ephemeral]).toEqual([true, true])
    expect(flagsOf(await interaction.fetchReply())).toEqual(['Ephemeral', 'IsComponentsV2'])
  })

  it('keeps IsComponentsV2 through an edit whose flags leave it out', async () => {
    const interaction = command()
    await interaction.reply({ components: [text()], flags: IsComponentsV2 })

    await interaction.editReply({ components: [text('Again')], flags: [] })

    expect(flagsOf(await interaction.fetchReply())).toEqual(['IsComponentsV2'])
  })

  it('lets an edit set and clear SuppressEmbeds, and ignores the flags an edit cannot change', async () => {
    const interaction = command()
    await interaction.reply({ content: 'link', flags: SuppressEmbeds })

    // discord.js's types refuse it; a JavaScript caller can still send it
    await interaction.editReply({ content: 'link', flags: Ephemeral as never })

    expect(flagsOf(await interaction.fetchReply())).toEqual([])
  })

  it('keeps a private component message private when an update makes it Components V2', async () => {
    const interaction = createMockInteraction(ButtonInteraction, { message: createMockMessage({ flags: Ephemeral }) })

    await interaction.update({ components: [text()], flags: IsComponentsV2 })

    expect(flagsOf(await interaction.fetchReply())).toEqual(['Ephemeral', 'IsComponentsV2'])
  })

  it('refuses an update that puts embeds on a Components V2 component message', async () => {
    const interaction = createMockInteraction(ButtonInteraction, { message: createMockMessage({ flags: IsComponentsV2 }) })

    await expect(interaction.update({ embeds: [embed()] })).rejects.toMatchObject(INVALID_BODY)

    expect(interaction.replied).toBe(false)
  })

  it.each([
    ['a reply with content', (interaction: ChatInputCommandInteraction) => interaction.reply({ content: 'hi', components: [text()], flags: IsComponentsV2 })],
    ['a reply with embeds', (interaction: ChatInputCommandInteraction) => interaction.reply({ embeds: [embed()], components: [text()], flags: IsComponentsV2 })],
  ] as const)('refuses %s and IsComponentsV2 with a 400, leaving the interaction unanswered', async (_, send) => {
    const interaction = command()

    await expect(send(interaction)).rejects.toMatchObject(INVALID_BODY)

    expect([interaction.replied, getResponse(interaction).state]).toEqual([false, 'unanswered'])
  })

  it('refuses a follow-up with content and IsComponentsV2 with a 400', async () => {
    const interaction = command()
    await interaction.reply('first')

    await expect(interaction.followUp({ content: 'hi', components: [text()], flags: Ephemeral | IsComponentsV2 })).rejects.toMatchObject(INVALID_BODY)
  })

  it('refuses an edit that makes an embed reply Components V2 without clearing its embeds, and keeps the reply', async () => {
    const interaction = command()
    await interaction.reply({ embeds: [embed()] })

    await expect(interaction.editReply({ components: [text()], flags: IsComponentsV2 })).rejects.toMatchObject(INVALID_BODY)

    const reply = await interaction.fetchReply()
    expect([flagsOf(reply), reply.embeds.length]).toEqual([[], 1])
  })

  it('takes an edit that makes an embed reply Components V2 while clearing its content and embeds', async () => {
    const interaction = command()
    await interaction.reply({ content: 'hi', embeds: [embed()] })

    await interaction.editReply({ content: null, embeds: [], components: [text()], flags: IsComponentsV2 })

    const reply = await interaction.fetchReply()
    expect([flagsOf(reply), reply.embeds.length, reply.content]).toEqual([['IsComponentsV2'], 0, ''])
  })

  it('refuses embeds edited into a Components V2 reply', async () => {
    const interaction = command()
    await interaction.reply({ components: [text()], flags: IsComponentsV2 })

    await expect(interaction.editReply({ embeds: [embed()] })).rejects.toMatchObject(INVALID_BODY)
  })

  it('keeps a message’s flags through its own edit, and refuses content on a Components V2 one', async () => {
    const message = createMockMessage({ flags: IsComponentsV2 | SuppressEmbeds })

    await message.edit({ components: [text()], flags: [] })

    expect(flagsOf(message)).toEqual(['IsComponentsV2'])
    await expect(message.edit({ content: 'hi' })).rejects.toMatchObject(INVALID_BODY)
  })

  it.each([
    ["a channel's send with content", () => command().channel!.send({ content: 'hi', components: [text()], flags: IsComponentsV2 })],
    ["a message's reply with embeds", () => createMockMessage().reply({ embeds: [embed()], components: [text()], flags: IsComponentsV2 })],
    ["a user's direct message with content", () => command().user.send({ content: 'hi', components: [text()], flags: IsComponentsV2 })],
  ] as const)('refuses %s and IsComponentsV2 with a 400', async (_, send) => {
    await expect(send()).rejects.toMatchObject(INVALID_BODY)
  })

  it("takes a channel's send and a message's reply that hold only components", async () => {
    const options = { components: [text()], flags: IsComponentsV2 } as const

    const messages = await Promise.all([command().channel!.send(options), createMockMessage().reply(options)])

    expect(messages.map(flagsOf)).toEqual([['IsComponentsV2'], ['IsComponentsV2']])
  })
})

describe('Components V2 edits in default mode', () => {
  it('keeps the flags an edit gives, as before, and warns once that strict mocks keep Ephemeral', async () => {
    const interaction = command()
    await interaction.reply({ components: [text()], flags: Ephemeral | IsComponentsV2 })

    await interaction.editReply({ components: [text('Again')], flags: IsComponentsV2 })
    await interaction.editReply({ components: [text('Once more')], flags: [] })

    expect(flagsOf(await interaction.fetchReply())).toEqual([])
    expect(warned).toEqual([expect.stringMatching(/^editReply\(\) here sets the message's flags to the edit's.*5\.0.*useStrictMocks\(\)/s)])
  })

  it('sends content with IsComponentsV2, as before, and warns once that Discord refuses it', async () => {
    const interaction = command()

    await interaction.reply({ content: 'hi', components: [text()], flags: IsComponentsV2 })

    expect(interaction.replied).toBe(true)
    expect(warned).toEqual([expect.stringMatching(/^reply\(\) here sends a Components V2 message with content.*400.*5\.0.*useStrictMocks\(\)/s)])
  })

  it.each([
    ['send', () => command().channel!.send({ content: 'hi', components: [text()], flags: IsComponentsV2 })],
    ['reply', () => createMockMessage().reply({ embeds: [embed()], components: [text()], flags: IsComponentsV2 })],
  ] as const)('sends what %s() gives with IsComponentsV2 and content or embeds, as before, with a warning', async (method, send) => {
    const message = await send()

    expect(flagsOf(message)).toEqual(['IsComponentsV2'])
    expect(warned).toEqual([expect.stringMatching(new RegExp(`^${method}\\(\\) here sends a Components V2 message with (content|embeds).*400`, 's'))])
  })

  it('keeps the embeds an edit making a reply Components V2 leaves, as before, with a warning', async () => {
    const interaction = command()
    await interaction.reply({ embeds: [embed()] })

    await interaction.editReply({ components: [text()], flags: IsComponentsV2 })

    expect((await interaction.fetchReply()).embeds).toHaveLength(1)
    expect(warned).toEqual([expect.stringMatching(/^editReply\(\) here sends a Components V2 message with embeds/)])
  })

  it("doesn't warn of the flags of MeoCord's own edit of a private reply", async () => {
    const interaction = command()
    await respond(interaction).send({ content: 'first', flags: Ephemeral })

    await respond(interaction).send('second')

    expect(warned).toEqual([])
  })

  it('warns of nothing for Components V2 answers Discord takes', async () => {
    const interaction = command()
    await interaction.reply({ components: [text()], flags: IsComponentsV2 })

    await interaction.editReply({ components: [text('Again')], flags: IsComponentsV2 })
    await interaction.followUp({ components: [text('More')], flags: Ephemeral | IsComponentsV2 })

    expect(warned).toEqual([])
  })
})
