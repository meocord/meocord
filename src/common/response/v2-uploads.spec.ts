import {
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
import { createModalFields, createMockInteraction } from '@src/testing/index.js'
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

function on(message: Message, kind: keyof typeof ON_MESSAGE = 'button') {
  const interaction = ON_MESSAGE[kind](message)
  setPresenter(interaction.client, withFiles)
  return interaction as ButtonInteraction
}

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
    expect(mediaOf(await interaction.fetchReply())).toEqual([expect.objectContaining({ url: before.url, loading_state: 2 })])
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
