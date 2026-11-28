import {
  type APIFileComponent,
  type APIMediaGalleryComponent,
  type APIUnfurledMediaItem,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  FileBuilder,
  type Message,
  MediaGalleryBuilder,
  MessageFlags,
  TextChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockInteraction, createMockMessage, UNDEFINED_ANSWER_WARNING } from '@src/testing/mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void (String(text) === UNDEFINED_ANSWER_WARNING || warned.push(String(text))))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const png = (name = 'probe.png') => ({ name, attachment: Buffer.from('png') })
const zip = (name = 'probe.zip') => ({ name, attachment: Buffer.from('zip') })
const gallery = (name = 'probe.png') => new MediaGalleryBuilder().addItems({ media: { url: `attachment://${name}` } })
const file = (name = 'probe.zip') => new FileBuilder().setURL(`attachment://${name}`)
const button = (message?: Message) => createMockInteraction(ButtonInteraction, message ? { message } : {})
const CDN = /^https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/probe\.png/

/** Every top-level gallery's first item, and every File component's file, as a message reads back. */
function mediaOf(message: Message): APIUnfurledMediaItem[] {
  return message.components.flatMap(component => {
    const json = component.toJSON()
    if (json.type === ComponentType.MediaGallery) return [(json as APIMediaGalleryComponent).items[0].media]
    if (json.type === ComponentType.File) return [(json as APIFileComponent).file]
    return []
  })
}
const namesOf = (message: Message) => [...message.attachments.values()].map(attachment => attachment.name)

/** Discord's refusal of a form field, as its 400 body has it. */
const refusal = (code: string) => ({ code: 50035, status: 400, message: expect.stringContaining(`[${code}]`) })

describe("a message's uploads under useStrictMocks(), as Discord keeps them", () => {
  beforeEach(() => useStrictMocks())

  it('records an upload a V2 component shows by its CDN URL, with attachment_id', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })

    const reply = await interaction.fetchReply()
    const [media] = mediaOf(reply)
    expect(media.url).toMatch(CDN)
    expect(media).toMatchObject({ attachment_id: expect.any(String), content_type: 'image/png', loading_state: 2 })
    expect(media.url).toContain(`/${media.attachment_id}/`)
    // Discord lists only the files no component or embed references
    expect(namesOf(reply)).toEqual([])
  })

  it("puts a private message's uploads under ephemeral-attachments", async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 | Ephemeral })

    const [media] = mediaOf(await interaction.fetchReply())
    expect(media.url).toMatch(/^https:\/\/cdn\.discordapp\.com\/ephemeral-attachments\/\d+\/\d+\/probe\.png/)
  })

  it("shows an embed's uploaded image by CDN URL, and leaves it out of attachments", async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setImage('attachment://card.png').setFooter({ text: 'f', iconURL: 'attachment://icon.png' })], files: [png('card.png'), png('icon.png')] })

    const reply = await interaction.fetchReply()
    const [embed] = reply.embeds
    expect(embed.image?.url).toMatch(/^https:\/\/cdn\.discordapp\.com\/attachments\/\d+\/\d+\/card\.png/)
    expect(embed.footer?.iconURL).toMatch(/\/icon\.png/)
    expect(namesOf(reply)).toEqual([])
  })

  it.each([
    ['by id alone', (id: string) => [{ id }]],
    ['with its filename', (id: string) => [{ id, filename: 'card.png' }]],
    ["as discord.js's Attachment", (id: string) => [{ id, name: 'card.png' }]],
    ['not at all, with no attachments', () => undefined],
  ])("resolves an embed's attachment:// to a kept upload listed %s", async (_how, list) => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setImage('attachment://card.png')], files: [png('card.png')] })
    const before = (await interaction.fetchReply()).embeds[0].image?.url
    const id = before!.split('/').at(-2)!

    const attachments = list(id)
    await interaction.editReply({ embeds: [new EmbedBuilder().setImage('attachment://card.png')], ...(attachments && { attachments: attachments as never }) })

    expect((await interaction.fetchReply()).embeds[0].image?.url).toBe(before)
  })

  it("keeps the embed upload of a component's message that an edit after deferUpdate lists", async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setImage('attachment://card.png')], files: [png('card.png')] })
    const message = await interaction.fetchReply()
    const id = message.embeds[0].image!.url.split('/').at(-2)!
    const click = button(message)
    await click.deferUpdate()

    await click.editReply({ files: [png('loading.png')], attachments: [{ id, filename: 'card.png' }] as never })
    // Kept: the embed still reaches it, and Discord lists only the loading file no embed shows
    await click.editReply({ embeds: [new EmbedBuilder().setImage('attachment://card.png')] })

    const reply = await click.fetchReply()
    expect(reply.embeds[0].image?.url).toBe(message.embeds[0].image?.url)
    expect(namesOf(reply)).toEqual(['loading.png'])
  })

  it('lists an upload nothing references', async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Report')], files: [png()] })

    expect(namesOf(await interaction.fetchReply())).toEqual(['probe.png'])
  })

  it('removes an upload an edit does not list, and its media reads back not found', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })

    await interaction.editReply({ files: [png('loading.png')], attachments: [] })

    const reply = await interaction.fetchReply()
    const [media] = mediaOf(reply)
    expect(media).toMatchObject({ loading_state: 3, content_type: null })
    expect(media).not.toHaveProperty('attachment_id')
    expect(namesOf(reply)).toEqual(['loading.png'])
  })

  it('reads media back not found that a later edit points at an upload an earlier one removed', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const sent = (await interaction.fetchReply()).components.map(component => component.toJSON())
    await interaction.editReply({ files: [png('loading.png')], attachments: [] })

    // As a lock's restore re-sends the message as it was: the upload's CDN URL, with nothing listed
    await interaction.editReply({ components: sent as never, attachments: [] })

    expect(mediaOf(await interaction.fetchReply())[0]).toMatchObject({ loading_state: 3, content_type: null })
  })

  it('keeps only the new files after an edit with files and no attachments, as discord.js lists them alone', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })

    await interaction.editReply({ files: [png('loading.png')] })

    const reply = await interaction.fetchReply()
    expect(mediaOf(reply)[0]).toMatchObject({ loading_state: 3 })
    expect(namesOf(reply)).toEqual(['loading.png'])
  })

  it("drops an embed message's upload after an edit with files and no attachments", async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Report')], files: [png()] })

    await interaction.editReply({ files: [png('loading.png')] })

    expect(namesOf(await interaction.fetchReply())).toEqual(['loading.png'])
  })

  it('keeps the uploads an edit lists, beside its new files', async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Report')], files: [png()] })
    const [kept] = (await interaction.fetchReply()).attachments.values()

    await interaction.editReply({ files: [png('loading.png')], attachments: [kept] })

    expect(namesOf(await interaction.fetchReply())).toEqual(['probe.png', 'loading.png'])
  })

  it('keeps media the edit does not send linked while the edit lists its upload', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [media] = mediaOf(await interaction.fetchReply())

    await interaction.editReply({ files: [png('loading.png')], attachments: [{ id: media.attachment_id! }] as never })

    const reply = await interaction.fetchReply()
    expect(mediaOf(reply)[0]).toMatchObject({ loading_state: 2, attachment_id: media.attachment_id })
    expect(namesOf(reply)).toEqual(['loading.png'])
  })

  it("keeps an embed component message's upload that an edit after deferUpdate lists", async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Report')], files: [png()] })
    const message = await interaction.fetchReply()
    const click = button(message)
    await click.deferUpdate()

    await click.editReply({ files: [png('loading.png')], attachments: [...message.attachments.values()] })

    expect(namesOf(await click.fetchReply())).toEqual(['probe.png', 'loading.png'])
  })

  it('keeps every upload through an edit with neither files nor attachments', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery(), file()], files: [png(), zip()], flags: IsComponentsV2 })
    const before = mediaOf(await interaction.fetchReply()).map(media => media.attachment_id)

    // attachment:// of a kept upload resolves to it when the edit lists no attachments
    await interaction.editReply({ components: [gallery(), file()] })

    const after = mediaOf(await interaction.fetchReply())
    expect(after.map(media => media.attachment_id)).toEqual(before)
    expect(after.map(media => media.loading_state)).toEqual([2, 2])
  })

  it('refuses attachment:// of a kept upload the edit lists by id alone', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [media] = mediaOf(await interaction.fetchReply())

    await expect(interaction.editReply({ components: [gallery()], attachments: [{ id: media.attachment_id! }] as never })).rejects.toMatchObject({
      ...refusal('UNFURLED_MEDIA_ITEM_REFERENCED_ATTACHMENT_NOT_FOUND'),
      message: 'Invalid Form Body\ncomponents[0].items[0].media.url[UNFURLED_MEDIA_ITEM_REFERENCED_ATTACHMENT_NOT_FOUND]: ' +
        'The referenced attachment ("attachment://probe.png") was not found',
    })
    // Refused whole: the message is as it was
    expect(mediaOf(await interaction.fetchReply())[0]).toEqual(media)
  })

  it("refuses attachment:// of a kept upload listed as discord.js's Attachment, which has a name and no filename", async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [media] = mediaOf(await interaction.fetchReply())

    await expect(
      interaction.editReply({ components: [gallery()], attachments: [{ id: media.attachment_id!, name: 'probe.png' }] as never }),
    ).rejects.toMatchObject(refusal('UNFURLED_MEDIA_ITEM_REFERENCED_ATTACHMENT_NOT_FOUND'))
  })

  it('keeps a kept upload linked through attachment:// when the edit lists it with its filename', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery(), file()], files: [png(), zip()], flags: IsComponentsV2 })
    const before = mediaOf(await interaction.fetchReply())
    const listed = before.map(media => ({ id: media.attachment_id!, filename: media.url.split('/').at(-1)!.split('?')[0] }))

    await interaction.editReply({ components: [gallery(), file()], attachments: listed as never })
    await interaction.editReply({ components: [gallery(), file()], files: [png('loading.png')], attachments: listed as never })

    const reply = await interaction.fetchReply()
    expect(mediaOf(reply).map(media => [media.attachment_id, media.loading_state])).toEqual(before.map(media => [media.attachment_id, 2]))
    expect(namesOf(reply)).toEqual(['loading.png'])
  })

  it('resolves attachment:// to the new file of that name over a kept upload the edit lists', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(await interaction.fetchReply())

    await interaction.editReply({ components: [gallery()], files: [png()], attachments: [{ id: before.attachment_id!, filename: 'probe.png' }] as never })

    const [after] = mediaOf(await interaction.fetchReply())
    expect(after).toMatchObject({ loading_state: 2, attachment_id: expect.any(String) })
    expect(after.attachment_id).not.toBe(before.attachment_id)
  })

  it.each([
    ['older first', (older: string, newer: string) => [older, newer]],
    ['newer first', (older: string, newer: string) => [newer, older]],
    ['no attachments key', undefined],
  ] as const)('resolves attachment:// to the newer of two kept uploads of one name, listed %s', async (_case, order) => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [{ attachment_id: older }] = mediaOf(await interaction.fetchReply())
    await interaction.editReply({ components: [gallery()], files: [png()], attachments: [{ id: older!, filename: 'probe.png' }] as never })
    const [{ attachment_id: newer }] = mediaOf(await interaction.fetchReply())

    const listed = order?.(older!, newer!).map(id => ({ id, filename: 'probe.png' }))
    await interaction.editReply({ components: [gallery()], ...(listed && { attachments: listed as never }) })

    const reply = await interaction.fetchReply()
    expect(mediaOf(reply)[0]).toMatchObject({ attachment_id: newer, loading_state: 2 })
    // The older one stays on the message, shown by nothing
    expect(namesOf(reply)).toEqual(['probe.png'])
  })

  it('refuses an attachment the message does not have', async () => {
    const interaction = button()
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('Report')], files: [png()] })

    await expect(interaction.editReply({ attachments: [{ id: '1' }] as never })).rejects.toMatchObject({
      ...refusal('ATTACHMENT_NOT_FOUND'),
      message: 'Invalid Form Body\nattachments[0][ATTACHMENT_NOT_FOUND]: Attachment data not found',
    })
  })

  it('refuses a kept upload listed under another filename, and the attachment:// it would name', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [media] = mediaOf(await interaction.fetchReply())

    const renamed = [{ id: media.attachment_id!, filename: 'other.png' }] as never
    await expect(interaction.editReply({ components: [gallery('other.png')], attachments: renamed })).rejects.toMatchObject({
      ...refusal('ATTACHMENT_CANNOT_CHANGE_FILENAME'),
      message: 'Invalid Form Body\nattachments[0][ATTACHMENT_CANNOT_CHANGE_FILENAME]: Attachment filenames cannot be changed',
    })
    await expect(interaction.editReply({ components: [gallery()], attachments: renamed })).rejects.toMatchObject({
      message:
        'Invalid Form Body\ncomponents[0].items[0].media.url[UNFURLED_MEDIA_ITEM_REFERENCED_ATTACHMENT_NOT_FOUND]: The referenced attachment ("attachment://probe.png") was not found\n' +
        'attachments[0][ATTACHMENT_CANNOT_CHANGE_FILENAME]: Attachment filenames cannot be changed',
    })
  })

  it('takes a gallery re-sent with its CDN URL, which then reads back without attachment_id', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const reply = await interaction.fetchReply()

    await interaction.editReply({ components: reply.components.map(component => component.toJSON()) as never })

    const after = await interaction.fetchReply()
    const [media] = mediaOf(after)
    expect(media.url).toMatch(CDN)
    expect(media).toMatchObject({ loading_state: 2 })
    expect(media).not.toHaveProperty('attachment_id')
    // Its URL still shows the upload, which Discord so leaves out of attachments
    expect(namesOf(after)).toEqual([])
  })

  it("answers a click's first edit that links a kept upload through attachment:// with it loaded, and a CDN re-send with it loading", async () => {
    const sent = async () => {
      const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'card' })
      await command.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
      const click = button(await command.fetchReply())
      await click.deferUpdate()
      return click
    }
    const linking = await sent()
    const resending = await sent()

    const linked = await linking.editReply({ components: [gallery()] })
    const resent = await resending.editReply({ components: resending.message.components.map(component => component.toJSON()) as never })

    // As Discord answers the first edit that keeps an upload: linked, it stays linked; by CDN URL, it is processed again
    expect(mediaOf(linked)[0]).toMatchObject({ attachment_id: mediaOf(linking.message)[0].attachment_id, loading_state: 2 })
    expect(mediaOf(resent)[0]).toMatchObject({ loading_state: 1 })
    expect(mediaOf(resent)[0]).not.toHaveProperty('attachment_id')
  })

  it("answers a click's first edit with a kept upload and a new one both linked and loaded", async () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'card' })
    await command.reply({ components: [gallery('a.png')], files: [png('a.png')], flags: IsComponentsV2 })
    const click = button(await command.fetchReply())
    await click.deferUpdate()
    const [kept] = mediaOf(click.message)

    const edited = await click.editReply({
      components: [gallery('a.png'), gallery('b.png')],
      files: [png('b.png')],
      attachments: [{ id: kept.attachment_id, filename: 'a.png' }],
    } as never)

    const [a, b] = mediaOf(edited)
    expect(a).toMatchObject({ attachment_id: kept.attachment_id, loading_state: 2 })
    expect(b).toMatchObject({ attachment_id: expect.any(String), loading_state: 2 })
    expect(b?.attachment_id).not.toBe(kept.attachment_id)
  })

  it("answers a click's first edit with an image from outside Discord loaded, as only uploads are processed again", async () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'card' })
    await command.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const click = button(await command.fetchReply())
    await click.deferUpdate()
    const external = new MediaGalleryBuilder().addItems({ media: { url: 'https://example.com/card.png' } })

    const edited = await click.editReply({ components: [external] })

    expect(mediaOf(edited)[0]).toMatchObject({ url: 'https://example.com/card.png', loading_state: 2 })
  })

  it('links media again that a CDN re-send unlinked, through attachment:// with no attachments', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const sent = await interaction.fetchReply()
    const [linked] = mediaOf(sent)
    await interaction.editReply({ components: sent.components.map(component => component.toJSON()) as never })

    await interaction.editReply({ components: [gallery()] })

    expect(mediaOf(await interaction.fetchReply())[0]).toMatchObject({ attachment_id: linked.attachment_id, loading_state: 2 })
  })

  it("holds the upload of a component's message whose media a CDN re-send unlinked", async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const sent = await interaction.fetchReply()
    const [linked] = mediaOf(sent)
    await interaction.editReply({ components: sent.components.map(component => component.toJSON()) as never })
    const click = button(await interaction.fetchReply())
    await click.deferUpdate()

    // Still the message's upload: re-sent by its URL it stays loaded, and attachment:// links it again
    await click.editReply({ components: (await click.fetchReply()).components.map(component => component.toJSON()) as never })
    expect(mediaOf(await click.fetchReply())[0]).toMatchObject({ url: linked.url, loading_state: 2 })
    await click.editReply({ components: [gallery()] })
    expect(mediaOf(await click.fetchReply())[0]).toMatchObject({ attachment_id: linked.attachment_id, loading_state: 2 })
  })

  it('shows a CDN URL from another channel as it was sent, an image the message does not hold', async () => {
    const interaction = button()
    const elsewhere = 'https://cdn.discordapp.com/attachments/1/2/probe.png?ex=0&is=0&hm=0'
    await interaction.reply({ components: [new MediaGalleryBuilder().addItems({ media: { url: elsewhere } })], flags: IsComponentsV2 })

    await interaction.editReply({ components: [new MediaGalleryBuilder().addItems({ media: { url: elsewhere } })] })

    const [media] = mediaOf(await interaction.fetchReply())
    expect(media.url).toBe(elsewhere)
    expect(media.loading_state).not.toBe(3)
    expect(media).not.toHaveProperty('attachment_id')

    // Nor does a component's message showing it hold it: listing its id is refused
    const click = button(await interaction.fetchReply())
    await click.deferUpdate()
    await expect(click.editReply({ attachments: [{ id: '2', filename: 'probe.png' }] as never })).rejects.toMatchObject(refusal('ATTACHMENT_NOT_FOUND'))
  })

  it('refuses a File component re-sent with its CDN URL', async () => {
    const interaction = button()
    await interaction.reply({ components: [file()], files: [zip()], flags: IsComponentsV2 })
    const reply = await interaction.fetchReply()

    await expect(interaction.editReply({ components: reply.components.map(component => component.toJSON()) as never })).rejects.toMatchObject({
      ...refusal('UNFURLED_MEDIA_ITEM_MUST_USE_ATTACHMENT_PROTOCOL'),
      message:
        'Invalid Form Body\ncomponents[0].file.url[UNFURLED_MEDIA_ITEM_MUST_USE_ATTACHMENT_PROTOCOL]: This UnfurledMediaItem does not ' +
        'support arbitrary external urls. You must use the `attachment://` reference system.',
    })
  })

  it('refuses a File component pointed at any URL', async () => {
    const interaction = button()
    const external: APIFileComponent = { type: ComponentType.File, file: { url: 'https://example.com/report.zip' } }

    await expect(interaction.reply({ components: [external], flags: IsComponentsV2 })).rejects.toMatchObject(refusal('UNFURLED_MEDIA_ITEM_MUST_USE_ATTACHMENT_PROTOCOL'))
  })

  it('resolves two uploads of one name to the first, and lists neither', async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery(), gallery()], files: [png(), png()], flags: IsComponentsV2 })

    const reply = await interaction.fetchReply()
    expect(namesOf(reply)).toEqual([])
    const [first, second] = mediaOf(reply)
    expect(first.attachment_id).toEqual(expect.any(String))
    expect(second.attachment_id).toBe(first.attachment_id)
  })

  it("removes the uploads of a component's message that an edit after deferUpdate does not list", async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const click = button(await interaction.fetchReply())
    await click.deferUpdate()

    await click.editReply({ files: [png('loading.png')], attachments: [] })

    expect(mediaOf(await click.fetchReply())[0]).toMatchObject({ loading_state: 3 })
  })

  it("keeps a component's message's uploads through an update with neither files nor attachments", async () => {
    const interaction = button()
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const message = await interaction.fetchReply()
    const click = button(message)

    await click.update({ components: [gallery()] })

    expect(mediaOf(await click.fetchReply())[0]).toMatchObject({ loading_state: 2, attachment_id: mediaOf(message)[0].attachment_id })
  })

  it("records a channel send's uploads, and a message edit's", async () => {
    const channel = createMockChannel(TextChannel)
    const sent = await channel.send({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    expect(mediaOf(sent)[0].url).toMatch(CDN)

    await sent.edit({ files: [png('loading.png')], attachments: [] })

    expect(mediaOf(sent)[0]).toMatchObject({ loading_state: 3 })
    expect(namesOf(sent)).toEqual(['loading.png'])
  })

  it('records the uploads of a mock message given V2 media with attachment_id', async () => {
    const reply = await (async () => {
      const interaction = button()
      await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
      return interaction.fetchReply()
    })()
    const message = createMockMessage({ components: reply.components.map(component => component.toJSON()) as never, flags: IsComponentsV2 })

    await message.edit({ files: [png('loading.png')], attachments: [] })

    expect(mediaOf(message)[0]).toMatchObject({ loading_state: 3 })
  })
})

describe("a message's uploads in default mode", () => {
  it('keeps what it reads back, and warns once for each call that strict mocks record uploads as Discord does', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
    await interaction.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    await interaction.editReply({ files: [png('loading.png')], attachments: [] })

    // As before: the media keeps the attachment:// it was sent with, and nothing is listed
    const reply = await interaction.fetchReply()
    expect(mediaOf(reply)[0]).toMatchObject({ url: 'attachment://probe.png', loading_state: 2 })
    expect(namesOf(reply)).toEqual([])
    expect(warned).toEqual([
      expect.stringMatching(/^reply\(\) here sends files.*5\.0.*useStrictMocks\(\)/s),
      expect.stringMatching(/^editReply\(\) here sends files/),
    ])
  })

  it("answers a click's first edit with media sent with an attachment_id loading and without it, as before", async () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'card' })
    await command.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const click = button(await command.fetchReply())
    await click.deferUpdate()
    const media = { url: 'https://cdn.discordapp.com/attachments/111/222/probe.png', attachment_id: '222' }

    const edited = await click.editReply({ components: [{ type: ComponentType.MediaGallery, items: [{ media }] }] as never })

    expect(mediaOf(edited)[0]).toMatchObject({ url: media.url, loading_state: 1 })
    expect(mediaOf(edited)[0]).not.toHaveProperty('attachment_id')
  })

  it('takes a File component pointed at a URL, and warns once that Discord refuses it', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
    const external: APIFileComponent = { type: ComponentType.File, file: { url: 'https://example.com/report.zip' } }

    await interaction.reply({ components: [external], flags: IsComponentsV2 })

    expect(warned).toEqual([expect.stringMatching(/^reply\(\) here sends a File component.*attachment:\/\/.*400.*5\.0.*useStrictMocks\(\)/s)])
  })
})
