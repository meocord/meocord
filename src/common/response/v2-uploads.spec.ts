import {
  ActionRowBuilder,
  Attachment,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type APIFileComponent,
  type APIMediaGalleryComponent,
  type APIUnfurledMediaItem,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  FileBuilder,
  type Interaction,
  type Message,
  MediaGalleryBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  SectionBuilder,
  StringSelectMenuInteraction,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { respond, responseOf } from '@src/common/response/response-state.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { type ResponsePresenter } from '@src/interface/index.js'
import { createModalFields, createMockInteraction, createMockMessage } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

const { Ephemeral, IsComponentsV2 } = MessageFlags

const png = (name = 'probe.png') => ({ name, attachment: Buffer.from('png') })
const zip = (name = 'probe.zip') => ({ name, attachment: Buffer.from('zip') })
const gallery = (name = 'probe.png') => new MediaGalleryBuilder().addItems({ media: { url: `attachment://${name}` } })

/** A presenter whose loading and error views carry a file of their own. */
const withFiles: ResponsePresenter = {
  loading: () => ({ text: 'Working', files: [{ name: 'loading.png', data: Buffer.from('png') }] }),
  error: (_context, { message }) => ({ text: message, files: [{ name: 'error.png', data: Buffer.from('png') }] }),
}

/** Every media item a message's components show, through sections and containers, as the message reads back. */
function mediaOf(message: Message): APIUnfurledMediaItem[] {
  const walk = (components: readonly { type: number }[]): APIUnfurledMediaItem[] =>
    components.flatMap(component => {
      switch (component.type) {
        case ComponentType.MediaGallery:
          return (component as APIMediaGalleryComponent).items.map(item => item.media)
        case ComponentType.File:
          return [(component as APIFileComponent).file]
        case ComponentType.Section: {
          const { accessory } = component as unknown as { accessory: { type: number; media?: APIUnfurledMediaItem } }
          return accessory.type === ComponentType.Thumbnail && accessory.media ? [accessory.media] : []
        }
        case ComponentType.Container:
          return walk((component as unknown as { components: { type: number }[] }).components)
        default:
          return []
      }
    })
  return walk(message.components.map(component => component.toJSON()))
}
const namesOf = (message: Message) => [...message.attachments.values()].map(attachment => attachment.name)

/** A message the bot sent with `options`, as Discord stores it, read back for a component on it. */
async function posted(options: Record<string, unknown>): Promise<Message> {
  const command = createMockInteraction(ChatInputCommandInteraction)
  await command.reply(options as never)
  return command.fetchReply()
}

const ON_MESSAGE = {
  button: (message: Message) => createMockInteraction(ButtonInteraction, { customId: 'go', message }),
  'select menu': (message: Message) => createMockInteraction(StringSelectMenuInteraction, { customId: 'pick', values: ['a'], message }),
  'modal from the message': (message: Message) =>
    createMockInteraction(ModalSubmitInteraction, { customId: 'form', message, fields: createModalFields({}) }),
} satisfies Record<string, (message: Message) => Interaction>

/** A presenter whose views carry no files. */
const plain: ResponsePresenter = {
  loading: () => ({ text: 'Working' }),
  error: (_context, { message }) => ({ text: message }),
}

function on(message: Message, kind: keyof typeof ON_MESSAGE = 'button', presenter = withFiles) {
  const interaction = ON_MESSAGE[kind](message)
  setPresenter(interaction.client, presenter)
  return interaction as ButtonInteraction
}

/** The first edit a call made, as discord.js received it. */
const firstEdit = (interaction: ButtonInteraction, call = 0) =>
  vi.mocked(interaction.editReply).mock.calls[call][0] as { attachments?: unknown[]; components?: { items?: { media: { url: string } }[]; file?: { url: string } }[]; embeds?: APIEmbed[] }

beforeEach(() => useStrictMocks())
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

describe("a lock with a loading view's files on a Components V2 message", () => {
  it.each(Object.keys(ON_MESSAGE) as (keyof typeof ON_MESSAGE)[])("keeps a gallery's upload linked through a %s's lock and restore", async kind => {
    const message = await posted({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message, kind)

    await respond(interaction).lock()
    const locked = await interaction.fetchReply()
    await responseOf(interaction).release()
    const restored = await interaction.fetchReply()

    for (const shown of [locked, restored]) expect(mediaOf(shown)[0]).toMatchObject({ attachment_id: before.attachment_id, url: before.url, loading_state: 2 })
    // The loading view showed its file, and the restore took it off again
    expect(mediaOf(locked).at(-1)).toMatchObject({ loading_state: 2 })
    expect(mediaOf(restored)).toHaveLength(1)
    expect(namesOf(restored)).toEqual([])
  })

  it('keeps a File component, which Discord takes only by attachment://', async () => {
    const message = await posted({ components: [new FileBuilder().setURL('attachment://probe.zip')], files: [zip()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    expect(mediaOf(await interaction.fetchReply())).toEqual([expect.objectContaining({ attachment_id: before.attachment_id, url: before.url })])
  })

  it("keeps the uploads a container's gallery and a section's thumbnail show", async () => {
    const message = await posted({
      components: [
        new ContainerBuilder().addMediaGalleryComponents(gallery()),
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('Side'))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://side.png')),
      ],
      files: [png(), png('side.png')],
      flags: IsComponentsV2,
    })
    const before = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    const after = mediaOf(await interaction.fetchReply())
    expect(after).toEqual(before.map(media => expect.objectContaining({ attachment_id: media.attachment_id, loading_state: 2 })))
  })

  it('keeps an upload whose media an earlier edit left without attachment_id', async () => {
    const command = createMockInteraction(ChatInputCommandInteraction)
    await command.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const sent = await command.fetchReply()
    await command.editReply({ components: sent.components.map(component => component.toJSON()) as never })
    const message = await command.fetchReply()
    const interaction = on(message)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    // Listed again by the id in its URL, and so linked again
    expect(mediaOf(await interaction.fetchReply())[0]).toMatchObject({ attachment_id: mediaOf(sent)[0].attachment_id, loading_state: 2 })
  })

  it('keeps the upload an answer replacing the drawn loading view leaves on the message', async () => {
    const message = await posted({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()
    await respond(interaction).send({ components: [message.components[0].toJSON(), new TextDisplayBuilder().setContent('Done')] as never })

    const answered = await interaction.fetchReply()
    expect(mediaOf(answered)).toEqual([expect.objectContaining({ attachment_id: before.attachment_id, loading_state: 2 })])
    expect(namesOf(answered)).toEqual([])
  })

  it('counts the uploads it keeps toward 10, dropping the loading files beside 10 with a warning', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const ten = Array.from({ length: 10 }, (_, index) => `${index}.png`)
    const message = await posted({ components: [new MediaGalleryBuilder().addItems(ten.map(name => ({ media: { url: `attachment://${name}` } })))], files: ten.map(name => png(name)), flags: IsComponentsV2 })
    const interaction = on(message)

    await respond(interaction).lock()

    expect(mediaOf(await interaction.fetchReply())).toEqual(Array.from({ length: 10 }, () => expect.objectContaining({ loading_state: 2 })))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('10 files'))
  })

  it('sends the loading file beside 9 uploads, keeping all 10', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => `${index}.png`)
    const message = await posted({ components: [new MediaGalleryBuilder().addItems(nine.map(name => ({ media: { url: `attachment://${name}` } })))], files: nine.map(name => png(name)), flags: IsComponentsV2 })
    const interaction = on(message)

    await respond(interaction).lock()

    const locked = mediaOf(await interaction.fetchReply())
    expect(locked).toHaveLength(10)
    expect(locked).toEqual(Array.from({ length: 10 }, () => expect.objectContaining({ loading_state: 2 })))
  })
})

describe('a lock keeping uploads that share a file name', () => {
  it("sends the loading view without its files when one is named like a kept upload, with a warning", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const message = await posted({ components: [gallery('loading.png')], files: [png('loading.png')], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()

    const [lock] = vi.mocked(interaction.editReply).mock.calls[0] as [{ files?: unknown[] }]
    expect(lock.files).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('loading.png is named like a file the message keeps'))
    expect(mediaOf(await interaction.fetchReply())).toEqual([expect.objectContaining({ attachment_id: before.attachment_id, loading_state: 2 })])
  })

  it('points attachment:// at the newer of two kept uploads of one name, and keeps the older on its URL', async () => {
    const command = createMockInteraction(ChatInputCommandInteraction)
    await command.reply({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [older] = mediaOf(await command.fetchReply())
    // The older upload shown by its URL, beside a newer upload of the same name
    const both = new MediaGalleryBuilder().addItems({ media: { url: older.url } }, { media: { url: 'attachment://probe.png' } })
    await command.editReply({ components: [both], files: [png()], attachments: [{ id: older.attachment_id!, filename: 'probe.png' }] as never })
    const message = await command.fetchReply()
    const [, newer] = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    const [lock] = vi.mocked(interaction.editReply).mock.calls[0] as [{ attachments?: unknown[] }]
    expect(lock.attachments).toEqual(expect.arrayContaining([{ id: older.attachment_id, filename: 'probe.png' }, { id: newer.attachment_id, filename: 'probe.png' }]))
    expect(mediaOf(await interaction.fetchReply())).toEqual([
      expect.objectContaining({ url: older.url, loading_state: 2 }),
      expect.objectContaining({ attachment_id: newer.attachment_id, loading_state: 2 }),
    ])
  })

  it('warns, naming it, of a File whose name a newer kept upload takes, and sends the edit Discord refuses', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const command = createMockInteraction(ChatInputCommandInteraction)
    await command.reply({ components: [new FileBuilder().setURL('attachment://probe.zip')], files: [zip()], flags: IsComponentsV2 })
    const [older] = mediaOf(await command.fetchReply())
    // A newer probe.zip that nothing shows, beside the File's older one
    await command.editReply({ files: [zip()], attachments: [{ id: older.attachment_id!, filename: 'probe.zip' }] as never })
    const interaction = on(await command.fetchReply())

    await respond(interaction).lock().catch(() => undefined)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('keeps probe.zip in a File component beside a newer upload of that name'))
    const [lock] = vi.mocked(interaction.editReply).mock.calls[0] as [{ components?: { file?: { url?: string } }[] }]
    expect(lock.components?.[0].file?.url).toBe(older.url)
  })
})

describe("an error view's files added to a private Components V2 message", () => {
  it("keeps the message's upload beside the error's file", async () => {
    const message = await posted({ components: [gallery()], files: [png()], flags: IsComponentsV2 | Ephemeral })
    const [before] = mediaOf(message)
    const interaction = on(message)

    await respond(interaction).lock()
    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    const shown = mediaOf(await interaction.fetchReply())
    expect(shown[0]).toMatchObject({ attachment_id: before.attachment_id, loading_state: 2 })
    expect(shown).toHaveLength(2)
  })

  it("sends the error without its files beside 10 uploads the message keeps, with a warning", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const ten = Array.from({ length: 10 }, (_, index) => `${index}.png`)
    const message = await posted({
      components: [new MediaGalleryBuilder().addItems(ten.map(name => ({ media: { url: `attachment://${name}` } })))],
      files: ten.map(name => png(name)),
      flags: IsComponentsV2 | Ephemeral,
    })
    const interaction = on(message)
    await interaction.deferUpdate()

    await respond(interaction).error(new Error('x'), { message: 'Broken.' })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 files beside the 10 the message keeps'))
    expect(mediaOf(await interaction.fetchReply())).toEqual(Array.from({ length: 10 }, () => expect.objectContaining({ loading_state: 2 })))
  })
})

describe('a lock with a loading view\'s files on an embed message', () => {
  it("lists the upload an embed shows, which Discord leaves out of the message's attachments", async () => {
    const message = await posted({ embeds: [new EmbedBuilder().setImage('attachment://card.png')], files: [png('card.png')] })
    const image = (message.embeds[0].toJSON() as APIEmbed).image?.url
    const interaction = on(message)

    await respond(interaction).lock()

    const [lock] = vi.mocked(interaction.editReply).mock.calls[0] as [{ attachments?: unknown[]; embeds?: APIEmbed[] }]
    expect(lock.attachments).toEqual([{ id: image?.split('/').at(-2), filename: 'card.png' }])
    expect(lock.embeds?.[0].image?.url).toBe('attachment://card.png')
    expect((await interaction.fetchReply()).embeds[0].image?.url).toBe(image)
  })
})

describe('a lock with no files of its own', () => {
  it("keeps a gallery's upload linked, listing nothing", async () => {
    const message = await posted({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message, 'button', plain)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    expect(firstEdit(interaction)).not.toHaveProperty('attachments')
    expect(firstEdit(interaction).components?.[0].items?.[0].media.url).toBe('attachment://probe.png')
    expect(mediaOf(await interaction.fetchReply())).toEqual([expect.objectContaining({ attachment_id: before.attachment_id, url: before.url })])
  })

  it('keeps a File component, which Discord refuses by its URL', async () => {
    const message = await posted({ components: [new FileBuilder().setURL('attachment://probe.zip')], files: [zip()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message, 'button', plain)

    await respond(interaction).lock()
    await responseOf(interaction).release()

    expect(mediaOf(await interaction.fetchReply())).toEqual([expect.objectContaining({ attachment_id: before.attachment_id })])
  })

  it("points an embed's uploaded images at attachment://, listing nothing", async () => {
    const embed = new EmbedBuilder().setImage('attachment://card.png').setFooter({ text: 'f', iconURL: 'attachment://icon.png' })
    const message = await posted({ embeds: [embed], files: [png('card.png'), png('icon.png')] })
    const interaction = on(message, 'button', plain)

    await respond(interaction).lock()

    expect(firstEdit(interaction)).not.toHaveProperty('attachments')
    expect(firstEdit(interaction).embeds?.[0]).toMatchObject({ image: { url: 'attachment://card.png' }, footer: { icon_url: 'attachment://icon.png' } })
  })
})

describe("an app's own edit of a message with uploads", () => {
  /** A button on a V2 message with an uploaded gallery and File, answered by `answer` with the message's components. */
  async function answering(answer: (interaction: ButtonInteraction, components: unknown[]) => Promise<unknown>) {
    const message = await posted({ components: [gallery(), new FileBuilder().setURL('attachment://probe.zip')], files: [png(), zip()], flags: IsComponentsV2 })
    const before = mediaOf(message)
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()
    await answer(interaction, message.components.map(component => component.toJSON()))
    return { before, interaction, after: mediaOf(await interaction.fetchReply()) }
  }
  const linked = (before: APIUnfurledMediaItem[]) => before.map(media => expect.objectContaining({ attachment_id: media.attachment_id }))

  it("keeps the uploads when it re-sends the message's components", async () => {
    const { before, after } = await answering((interaction, components) => respond(interaction).send({ components } as never))

    expect(after).toEqual(linked(before))
  })

  it('keeps the uploads it shows beside a file it adds without listing attachments', async () => {
    const { before, interaction, after } = await answering((interaction, components) =>
      respond(interaction).send({ components, files: [png('added.png')] } as never),
    )

    expect(after).toEqual(linked(before))
    expect(namesOf(await interaction.fetchReply())).toEqual(['added.png'])
  })

  it("keeps the uploads it lists as discord.js's Attachments, reshaped to { id, filename }", async () => {
    const { before, interaction, after } = await answering((interaction, components) => {
      const listed = mediaOf(interaction.message).map(media => ({ id: media.attachment_id!, name: media.url.split('/').at(-1)!.split('?')[0], size: 3 }))
      return respond(interaction).send({ components, attachments: listed } as never)
    })

    expect(after).toEqual(linked(before))
    expect(firstEdit(interaction).attachments).toEqual(before.map(media => ({ id: media.attachment_id, filename: media.url.split('/').at(-1)!.split('?')[0] })))
  })

  it('sends attachments: [] as given, so the message keeps none, its media left as given, with a warning', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { before, interaction, after } = await answering((interaction, components) =>
      respond(interaction).send({ components: components.slice(0, 1), attachments: [] } as never),
    )

    expect(firstEdit(interaction).attachments).toEqual([])
    expect(firstEdit(interaction).components?.[0].items?.[0].media.url).toBe(before[0].url)
    expect(after[0]).toMatchObject({ loading_state: 3 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sends an attachments list without probe.png, which its media still show: that media breaks. Remove it too, or keep the uploads listed.'))
  })

  it('leaves off the list, and on its URL, an upload the app does not list', async () => {
    const message = await posted({ components: [gallery(), new FileBuilder().setURL('attachment://probe.zip')], files: [png(), zip()], flags: IsComponentsV2 })
    const [shown, unlisted] = [mediaOf(message)[0], mediaOf(message)[1]]
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()
    const listed = [{ id: unlisted.attachment_id, filename: 'probe.zip' }]

    await respond(interaction).send({ components: [message.components[0].toJSON()], files: [png('added.png')], attachments: listed } as never)

    expect(firstEdit(interaction).attachments).toEqual(listed)
    expect(firstEdit(interaction).components?.[0].items?.[0].media.url).toBe(shown.url)
  })

  it("leaves another message's uploads alone in a follow-up answer that re-sends them", async () => {
    const message = await posted({ components: [gallery()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const command = createMockInteraction(ChatInputCommandInteraction)
    setPresenter(command.client, plain)
    await respond(command).acknowledge()
    // A private follow-up takes the public deferral's place, and is the answer edit() edits
    await respond(command).followUp({ components: [new TextDisplayBuilder().setContent('Follow-up')], flags: IsComponentsV2 | Ephemeral })

    await respond(command).edit({ components: message.components.map(component => component.toJSON()), files: [png('added.png')] } as never)

    const edits = vi.mocked(command.editReply).mock.calls.map(([edit]) => edit as { message?: unknown; attachments?: unknown; components?: { items?: { media: { url: string } }[] }[] })
    const edit = edits.at(-1)!
    expect(edit.message).toBeDefined()
    expect(edit).not.toHaveProperty('attachments')
    expect(edit.components?.[0].items?.[0].media.url).toBe(before.url)
  })

  it('keeps only its new files, with a warning, when they and the uploads it shows pass 10', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const ten = Array.from({ length: 10 }, (_, index) => `${index}.png`)
    const message = await posted({ components: [new MediaGalleryBuilder().addItems(ten.map(name => ({ media: { url: `attachment://${name}` } })))], files: ten.map(name => png(name)), flags: IsComponentsV2 })
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()

    await respond(interaction).send({ components: message.components.map(component => component.toJSON()), files: [png('added.png')] } as never)

    expect(firstEdit(interaction)).not.toHaveProperty('attachments')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`sends 1 files beside the 10 the message shows, and Discord takes 10: the message keeps only the new files, and drops ${ten.join(', ')}.`))
  })
})

describe('a toggle that re-sends the message with a control flipped', () => {
  /** The body a toggle builds: the components it read, each button disabled. */
  const toggled = (components: readonly unknown[]) =>
    JSON.parse(JSON.stringify(components), (_key, value) => (value && typeof value === 'object' && value.type === ComponentType.Button ? { ...value, disabled: true } : value))
  const row = () => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('go').setLabel('Go').setStyle(ButtonStyle.Primary))
  const galleryUrls = (calls: unknown[][]) =>
    calls.map(([body]) => ({ url: (body as { components: { items?: { media: { url: string } }[] }[] }).components[0].items?.[0].media.url, listed: 'attachments' in (body as object) }))

  it("keeps the gallery linked through update(), reading interaction.message's components", async () => {
    const message = await posted({ components: [gallery(), row()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message, 'button', plain)

    await respond(interaction).send({ components: toggled(responseOf(interaction).original?.components ?? message.components.map(component => component.toJSON())) } as never)

    expect(galleryUrls(vi.mocked(interaction.update).mock.calls)).toEqual([{ url: 'attachment://probe.png', listed: false }])
    expect(mediaOf(await interaction.fetchReply())[0]).toMatchObject({ attachment_id: before.attachment_id })
  })

  it("keeps the gallery linked through the lock and two edits, reading the lock's original", async () => {
    const message = await posted({ components: [gallery(), row()], files: [png()], flags: IsComponentsV2 })
    const [before] = mediaOf(message)
    const interaction = on(message, 'button', plain)
    await respond(interaction).lock()

    for (const _ of [1, 2]) await respond(interaction).send({ components: toggled(responseOf(interaction).original?.components ?? []) } as never)

    expect(galleryUrls(vi.mocked(interaction.editReply).mock.calls)).toEqual(Array.from({ length: 3 }, () => ({ url: 'attachment://probe.png', listed: false })))
    expect(mediaOf(await interaction.fetchReply())[0]).toMatchObject({ attachment_id: before.attachment_id })
  })
})

describe("an app list of discord.js's Attachments", () => {
  it('keeps a gallery and a File it lists, sent as { id, filename }', async () => {
    const message = await posted({ components: [gallery(), new FileBuilder().setURL('attachment://probe.zip')], files: [png(), zip()], flags: IsComponentsV2 })
    const before = mediaOf(message)
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()
    const names = ['probe.png', 'probe.zip']
    const attachments = before.map(
      (media, index) => new (Attachment as unknown as new (data: unknown) => Attachment)({ id: media.attachment_id, filename: names[index], url: media.url, proxy_url: media.url, size: 3 }),
    )

    await respond(interaction).send({ components: message.components.map(component => component.toJSON()), files: [png('added.png')], attachments } as never)

    expect(firstEdit(interaction).attachments).toEqual(before.map((media, index) => ({ id: media.attachment_id, filename: names[index] })))
    expect(mediaOf(await interaction.fetchReply())).toEqual(before.map(media => expect.objectContaining({ attachment_id: media.attachment_id })))
  })
})

describe("an app's attachments list that leaves out an upload its media show", () => {
  async function onUploads() {
    const message = await posted({ components: [gallery(), new FileBuilder().setURL('attachment://probe.zip')], files: [png(), zip()], flags: IsComponentsV2 })
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()
    return { message, interaction, before: mediaOf(message) }
  }
  const omittedWarnings = (warn: ReturnType<typeof vi.spyOn>) => warn.mock.calls.filter(([text]) => String(text).includes('an attachments list without'))

  it('sends the list as given, and warns once, naming the uploads it leaves out', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { message, interaction } = await onUploads()

    // message.attachments lists only the uploads nothing shows, none here; the File left on its URL is refused
    const sent = respond(interaction).send({ components: message.components.map(component => component.toJSON()), attachments: [...message.attachments.values()] } as never)

    await expect(sent).rejects.toThrow('UNFURLED_MEDIA_ITEM_MUST_USE_ATTACHMENT_PROTOCOL')
    expect(firstEdit(interaction).attachments).toEqual([])
    expect(omittedWarnings(warn)).toEqual([[expect.stringContaining('an attachments list without probe.png, probe.zip, which its media still show: that media breaks.')]])
  })

  it("warns the same way of an embed's image upload", async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const message = await posted({ embeds: [new EmbedBuilder().setImage('attachment://card.png')], files: [png('card.png')] })
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()

    await respond(interaction).send({ embeds: message.embeds.map(embed => embed.toJSON()), attachments: [] } as never)

    expect(omittedWarnings(warn)).toEqual([[expect.stringContaining('an attachments list without card.png, which its media still show: that media breaks.')]])
  })

  it('does not warn when the edit no longer shows the uploads it leaves out', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { interaction } = await onUploads()

    await respond(interaction).send({ components: [new TextDisplayBuilder().setContent('Done')], attachments: [] } as never)

    expect(firstEdit(interaction).attachments).toEqual([])
    expect(omittedWarnings(warn)).toEqual([])
  })

  it('does not warn for an upload a file the edit sends replaces by name', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { message, interaction, before } = await onUploads()

    await respond(interaction).send({ components: message.components.map(component => component.toJSON()), files: [png()], attachments: [{ id: before[1].attachment_id, filename: 'probe.zip' }] } as never)

    expect(omittedWarnings(warn)).toEqual([])
  })
})

describe("an app's attachments list naming the message's uploads by id alone", () => {
  it('sends each as { id, filename }, in its order, keeping a gallery and a File linked', async () => {
    const message = await posted({ components: [gallery(), new FileBuilder().setURL('attachment://probe.zip')], files: [png(), zip()], flags: IsComponentsV2 })
    const [image, file] = mediaOf(message)
    const interaction = on(message, 'button', plain)
    await interaction.deferUpdate()

    await respond(interaction).send({ components: message.components.map(component => component.toJSON()), attachments: [{ id: file.attachment_id }, { id: image.attachment_id, description: 'A probe' }] } as never)

    expect(firstEdit(interaction).attachments).toEqual([
      { id: file.attachment_id, filename: 'probe.zip' },
      { id: image.attachment_id, filename: 'probe.png', description: 'A probe' },
    ])
    expect(mediaOf(await interaction.fetchReply())).toEqual([image, file].map(media => expect.objectContaining({ attachment_id: media.attachment_id })))
  })
})

describe("an app's edit after @Defer's lock of a message with an upload", () => {
  it('sends the components it re-sends with the upload as attachment://, from the uploads the lock kept', async () => {
    // A fixture whose CDN URL names a channel the message isn't in: only the upload's attachment_id identifies it
    const message = createMockMessage({
      flags: IsComponentsV2,
      components: [{ type: ComponentType.MediaGallery, id: 1, items: [{ media: { url: 'https://cdn.discordapp.com/attachments/111/222/card.webp?ex=1&is=2&hm=3&', attachment_id: '222' } }] }] as never,
    })
    const interaction = on(message, 'button', plain)

    await respond(interaction).lock()
    await respond(interaction).edit({ components: message.components.map(component => component.toJSON()) } as never)

    expect(firstEdit(interaction, 1).components?.[0].items?.[0].media.url).toBe('attachment://card.webp')
  })
})
