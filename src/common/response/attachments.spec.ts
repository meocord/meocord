import { AttachmentBuilder, ComponentType, EmbedBuilder } from 'discord.js'
import { asListedEntry, attachmentFileName, keptUploads, listedUploads, rewriteAttachmentUrls, shadowedFiles } from '@src/common/response/attachments.js'

const cdn = (name: string, host = 'cdn.discordapp.com', folder = 'attachments') =>
  `https://${host}/${folder}/1/2/${name}?ex=abc&is=def&hm=123`
const kept = { names: new Set(['card.png']), uploads: new Map<string, string>() }

describe('attachmentFileName', () => {
  it('names the file of an attachment on either Discord CDN host, ephemeral ones included', () => {
    expect(attachmentFileName(cdn('card.png'))).toBe('card.png')
    expect(attachmentFileName(cdn('card.png', 'media.discordapp.net'))).toBe('card.png')
    expect(attachmentFileName(cdn('card.png', 'cdn.discordapp.com', 'ephemeral-attachments'))).toBe('card.png')
    expect(attachmentFileName(cdn('my%20card.png'))).toBe('my card.png')
  })

  it('names nothing for another host, another CDN path, a folder, or something that is not a URL', () => {
    expect(attachmentFileName('https://example.com/attachments/1/2/card.png')).toBeUndefined()
    expect(attachmentFileName('https://cdn.discordapp.com/avatars/1/card.png')).toBeUndefined()
    expect(attachmentFileName('https://cdn.discordapp.com/attachments/1/2/')).toBeUndefined()
    expect(attachmentFileName('not a url')).toBeUndefined()
    expect(attachmentFileName(42)).toBeUndefined()
    expect(attachmentFileName(undefined)).toBeUndefined()
  })
})

describe('keptUploads', () => {
  const at = (id: string, name: string) => `https://cdn.discordapp.com/attachments/1/${id}/${name}?ex=a&is=b&hm=c`
  const gallery = (...urls: string[]) => ({ type: ComponentType.MediaGallery, items: urls.map(url => ({ media: { url } })) })
  const urlsOf = (payload: { components?: readonly unknown[] }) =>
    (payload.components as { items: { media: { url: string } }[] }[]).flatMap(component => component.items.map(item => item.media.url))
  const own = [
    { id: '11', filename: 'a.png' },
    { id: '12', filename: 'b.png' },
    { id: '13', filename: 'unshown.txt' },
  ]

  it('sends an app list of none as it is, adding nothing and leaving its media as given', () => {
    const payload = { components: [gallery(at('11', 'a.png'))], files: [{ name: 'new.png' }], attachments: [] }

    const { payload: sent } = keptUploads(payload, own, 10)

    expect(sent.attachments).toEqual([])
    expect(urlsOf(sent)).toEqual([at('11', 'a.png')])
  })

  it('keeps an app list as given, only reshaping its Attachment entries, and points only the uploads it names at attachment://', () => {
    const payload = {
      components: [gallery(at('11', 'a.png'), at('12', 'b.png'), 'attachment://c.png', 'https://example.com/d.png')],
      attachments: [{ id: '12', name: 'b.png', description: 'B', size: 3 }, { id: '99' }, { id: '13', filename: 'unshown.txt' }],
    }

    const { payload: sent } = keptUploads(payload, own, 10)

    expect(sent.attachments).toEqual([{ id: '12', filename: 'b.png', description: 'B' }, { id: '99' }, { id: '13', filename: 'unshown.txt' }])
    expect(urlsOf(sent)).toEqual([at('11', 'a.png'), 'attachment://b.png', 'attachment://c.png', 'https://example.com/d.png'])
  })

  it('points the media of the message\'s own uploads at attachment:// in an edit with neither files nor a list, adding no list', () => {
    const payload = { components: [gallery(at('11', 'a.png'), 'https://cdn.discordapp.com/attachments/1/77/a.png')] }

    const { payload: sent } = keptUploads(payload, own, 10)

    expect(sent).not.toHaveProperty('attachments')
    expect(urlsOf(sent)).toEqual(['attachment://a.png', 'https://cdn.discordapp.com/attachments/1/77/a.png'])
  })

  it('lists the uploads it shows, and no other, when the edit sends files and no list; a file of a shown name replaces it', () => {
    const payload = { components: [gallery(at('11', 'a.png'), at('12', 'b.png'))], files: ['/tmp/cards/b.png'] }

    const { payload: sent } = keptUploads(payload, own, 10)

    expect((sent as { attachments?: unknown }).attachments).toEqual([{ id: '11', filename: 'a.png' }])
    expect(urlsOf(sent)).toEqual(['attachment://a.png', 'attachment://b.png'])
  })

  it('lists none, and says so, when the uploads it shows and its files pass the limit', () => {
    const payload = { components: [gallery(at('11', 'a.png'), at('12', 'b.png'))], files: [{ name: 'x.png' }, { name: 'y.png' }] }

    const result = keptUploads(payload, own, 3)

    expect(result.payload).not.toHaveProperty('attachments')
    expect(result.overLimit).toEqual({ files: 2, dropped: ['a.png', 'b.png'] })
    expect(urlsOf(result.payload)).toEqual([at('11', 'a.png'), at('12', 'b.png')])
  })

  it('reads the names of files sent as paths, named files, and builders', () => {
    const files = ['/tmp/cards/a.png', { attachment: '/tmp/b.png' }, { attachment: Buffer.from(''), name: 'c.png' }, new AttachmentBuilder(Buffer.from(''), { name: 'd.png' }), { attachment: Buffer.from('') }, 7, null]
    const payload = { components: [gallery(at('91', 'a.png'), at('92', 'b.png'), at('93', 'c.png'), at('94', 'd.png'))], files, attachments: [] }

    expect(urlsOf(keptUploads(payload, [], 10).payload)).toEqual(['attachment://a.png', 'attachment://b.png', 'attachment://c.png', 'attachment://d.png'])
  })

  it('points a name two own uploads share at the newer, keeping the older on its URL, and names a File it shadows', () => {
    const twins = [{ id: '20', filename: 'a.zip' }, { id: '30', filename: 'a.zip' }]
    const file = (id: string) => ({ type: ComponentType.File, file: { url: at(id, 'a.zip') } })

    const { payload, shadowed } = keptUploads({ components: [file('20'), file('30')] }, twins, 10)

    expect((payload.components as { file: { url: string } }[]).map(component => component.file.url)).toEqual([at('20', 'a.zip'), 'attachment://a.zip'])
    expect(shadowed).toEqual(['a.zip'])
    // A new file of the name takes both, so neither keeps a URL
    const replaced = keptUploads({ components: [file('20'), file('30')], files: [{ name: 'a.zip' }], attachments: twins }, twins, 10)
    expect((replaced.payload.components as { file: { url: string } }[]).map(component => component.file.url)).toEqual(['attachment://a.zip', 'attachment://a.zip'])
    expect(replaced.shadowed).toEqual([])
  })
})

describe('asListedEntry', () => {
  it('reshapes an Attachment-like entry to { id, filename }, keeping a description, and leaves any other entry', () => {
    expect(asListedEntry({ id: '1', name: 'a.png', description: 'A', url: 'u' })).toEqual({ id: '1', filename: 'a.png', description: 'A' })
    expect(asListedEntry({ id: '1', name: 'a.png', description: '' })).toEqual({ id: '1', filename: 'a.png' })
    const plain = { id: '1', filename: 'a.png', name: 'x' }
    expect(asListedEntry(plain)).toBe(plain)
    expect(asListedEntry({ id: '1' })).toEqual({ id: '1' })
    expect(asListedEntry(null)).toBeNull()
  })

  it("names a bare { id } of one of the message's own uploads, keeping its other fields, and leaves any other id", () => {
    const own = new Map([['1', 'a.png']])
    expect(asListedEntry({ id: '1' }, own)).toEqual({ id: '1', filename: 'a.png' })
    expect(asListedEntry({ id: '1', description: 'A' }, own)).toEqual({ id: '1', filename: 'a.png', description: 'A' })
    const foreign = { id: '2' }
    expect(asListedEntry(foreign, own)).toBe(foreign)
  })
})

describe('keptUploads with an attachments list', () => {
  const gallery = (...urls: string[]) => ({ type: ComponentType.MediaGallery, items: urls.map(url => ({ media: { url } })) })
  const cdn = (id: string, name: string) => `https://cdn.discordapp.com/attachments/9/${id}/${name}`
  const own = [
    { id: '1', filename: 'a.png' },
    { id: '2', filename: 'b.png' },
  ]

  it('names the own uploads its media show that the list leaves out, and only those', () => {
    expect(keptUploads({ components: [gallery(cdn('1', 'a.png'), cdn('2', 'b.png'))], attachments: [{ id: '2', filename: 'b.png' }] }, own, 10).omitted).toEqual(['a.png'])
    expect(keptUploads({ components: [gallery(cdn('2', 'b.png'))], attachments: [] }, own, 10).omitted).toEqual(['b.png'])
    expect(keptUploads({ components: [gallery(cdn('2', 'b.png'))], attachments: [{ id: '2' }] }, own, 10)).not.toHaveProperty('omitted')
    expect(keptUploads({ components: [], attachments: [] }, own, 10)).not.toHaveProperty('omitted')
    // A file the edit sends of that name replaces the upload
    expect(keptUploads({ components: [gallery(cdn('1', 'a.png'))], files: [{ name: 'a.png' }], attachments: [] }, own, 10)).not.toHaveProperty('omitted')
    // Without a list nothing is left out by the app
    expect(keptUploads({ components: [gallery(cdn('1', 'a.png'))] }, own, 10)).not.toHaveProperty('omitted')
  })
})

describe('rewriteAttachmentUrls', () => {
  it('points every embed image field at attachment:// for a kept file, and leaves the rest', () => {
    const [embed] = rewriteAttachmentUrls(
      {
        embeds: [
          new EmbedBuilder()
            .setImage(cdn('card.png'))
            .setThumbnail(cdn('card.png'))
            .setAuthor({ name: 'a', iconURL: cdn('card.png') })
            .setFooter({ text: 'f', iconURL: cdn('card.png') }),
        ],
      },
      kept,
    ).embeds as unknown as Record<string, { url?: string; icon_url?: string }>[]

    expect(embed.image.url).toBe('attachment://card.png')
    expect(embed.thumbnail.url).toBe('attachment://card.png')
    expect(embed.author.icon_url).toBe('attachment://card.png')
    expect(embed.footer.icon_url).toBe('attachment://card.png')
  })

  it('rewrites Components V2 thumbnails, files, and media inside sections and containers', () => {
    const { components } = rewriteAttachmentUrls(
      {
        components: [
          { type: ComponentType.Thumbnail, media: { url: cdn('card.png') } },
          { type: ComponentType.File, file: { url: cdn('card.png') } },
          {
            type: ComponentType.Container,
            components: [
              {
                type: ComponentType.Section,
                components: [{ type: ComponentType.TextDisplay, content: cdn('card.png') }],
                accessory: { type: ComponentType.Thumbnail, media: { url: cdn('card.png') } },
              },
              { type: ComponentType.MediaGallery, items: [{ media: { url: cdn('card.png') } }] },
            ],
          },
        ],
      },
      kept,
    )

    expect(components).toEqual([
      { type: ComponentType.Thumbnail, media: { url: 'attachment://card.png' } },
      { type: ComponentType.File, file: { url: 'attachment://card.png' } },
      {
        type: ComponentType.Container,
        components: [
          {
            type: ComponentType.Section,
            // Text is never rewritten, only media
            components: [{ type: ComponentType.TextDisplay, content: cdn('card.png') }],
            accessory: { type: ComponentType.Thumbnail, media: { url: 'attachment://card.png' } },
          },
          { type: ComponentType.MediaGallery, items: [{ media: { url: 'attachment://card.png' } }] },
        ],
      },
    ])
  })

  it('leaves a file not kept, and a component without media, as they are', () => {
    const payload = {
      embeds: [{ image: { url: cdn('gone.png') } }],
      components: [{ type: ComponentType.Thumbnail }, { type: ComponentType.File, file: null }, { type: ComponentType.File, file: 'not an object' }],
    }

    expect(rewriteAttachmentUrls(payload, kept)).toEqual(payload)
  })

  it('returns the payload itself when the edited message keeps no file', () => {
    const payload = { embeds: [new EmbedBuilder().setImage(cdn('card.png'))] }

    expect(rewriteAttachmentUrls(payload, { names: new Set(), uploads: new Map() })).toBe(payload)
  })

  it('points a kept upload at attachment:// by the id in its URL, whatever its name, and leaves an older one of its name', () => {
    const payload = {
      embeds: [{ image: { url: cdn('card.png') } }],
      components: [{ type: ComponentType.MediaGallery, items: [{ media: { url: cdn('card.png') } }, { media: { url: 'https://cdn.discordapp.com/attachments/1/9/card.png' } }] }],
    }

    const rewritten = rewriteAttachmentUrls(payload, { names: new Set(), uploads: new Map([['2', 'card.png']]) })

    expect(rewritten.embeds[0].image.url).toBe('attachment://card.png')
    expect(rewritten.components[0].items.map(item => item.media.url)).toEqual(['attachment://card.png', 'https://cdn.discordapp.com/attachments/1/9/card.png'])
  })
})

describe('listedUploads', () => {
  const at = (id: string, name: string, channel = '1', folder = 'attachments') => `https://cdn.discordapp.com/${folder}/${channel}/${id}/${name}?ex=a&is=b&hm=c`

  it("lists each upload once: media by attachment_id or their URL's path in the channel, embeds by path, then attachments", () => {
    const listed = listedUploads(
      {
        components: [
          { type: ComponentType.MediaGallery, items: [{ media: { url: at('11', 'a.png'), attachment_id: '11' } }, { media: { url: at('12', 'b.png') } }] },
          { type: ComponentType.Section, components: [], accessory: { type: ComponentType.Thumbnail, media: { url: at('13', 'c.png', '1', 'ephemeral-attachments') } } },
          { type: ComponentType.Container, components: [{ type: ComponentType.File, file: { url: at('11', 'a.png'), attachment_id: '11' } }] },
        ],
        embeds: [{ image: { url: at('14', 'd.png') }, thumbnail: { url: at('15', 'e.png') }, author: { name: 'x', icon_url: at('16', 'f.png') }, footer: { text: 'y', icon_url: at('17', 'g.png') } }],
      },
      [{ id: '18', name: 'h.txt' }, { id: '11', name: 'a.png' }],
      '1',
    )

    expect(listed).toEqual([
      { id: '11', filename: 'a.png' },
      { id: '12', filename: 'b.png' },
      { id: '13', filename: 'c.png' },
      { id: '14', filename: 'd.png' },
      { id: '15', filename: 'e.png' },
      { id: '16', filename: 'f.png' },
      { id: '17', filename: 'g.png' },
      { id: '18', filename: 'h.txt' },
    ])
  })

  it("lists no URL of another channel, another host, or no upload's path", () => {
    const listed = listedUploads(
      {
        components: [{ type: ComponentType.MediaGallery, items: [{ media: { url: at('21', 'a.png', '2') } }, { media: { url: 'https://example.com/attachments/1/22/b.png' } }, { media: { url: 'attachment://c.png' } }] }],
        embeds: [{ image: { url: at('23', 'd.png', '2') } }, new EmbedBuilder().setTitle('no image')],
      },
      [],
      '1',
    )

    expect(listed).toEqual([])
  })
})

describe('shadowedFiles', () => {
  it('names a File showing a candidate whose name a newer kept upload takes, and no other', () => {
    const file = (id: string, name: string) => ({ type: ComponentType.File, file: { url: `https://cdn.discordapp.com/attachments/1/${id}/${name}`, attachment_id: id } })
    const components = [file('20', 'a.zip'), { type: ComponentType.Container, components: [file('30', 'a.zip'), file('40', 'b.zip')] }]
    const candidates = [{ id: '20', filename: 'a.zip' }, { id: '30', filename: 'a.zip' }, { id: '40', filename: 'b.zip' }]
    const kept = { names: new Set<string>(), uploads: new Map([['30', 'a.zip'], ['40', 'b.zip']]) }

    expect(shadowedFiles({ components }, candidates, kept)).toEqual(['a.zip'])
    expect(shadowedFiles({ components }, [], kept)).toEqual([])
  })
})
