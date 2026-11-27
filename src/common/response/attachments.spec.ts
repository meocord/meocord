import { AttachmentBuilder, ComponentType, EmbedBuilder } from 'discord.js'
import { attachmentFileName, keptFiles, listedUploads, rewriteAttachmentUrls, shadowedFiles } from '@src/common/response/attachments.js'

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

describe('keptFiles', () => {
  it('reads the names of files sent as paths, named files, and builders', () => {
    const { names } = keptFiles(
      { files: ['/tmp/cards/a.png', { attachment: '/tmp/b.png' }, { attachment: Buffer.from(''), name: 'c.png' }, new AttachmentBuilder(Buffer.from(''), { name: 'd.png' }), { attachment: Buffer.from('') }, 7, null] },
      [],
    )

    expect([...names]).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
  })

  it("keeps the message's current attachments unless the edit lists the ones to keep", () => {
    const current = [{ name: 'old.png' }, { name: null }, {}]

    expect([...keptFiles({}, current).names]).toEqual(['old.png'])
    expect([...keptFiles({ attachments: [{ name: 'listed.png' }, null] }, current).names]).toEqual(['listed.png'])
  })

  it('keeps uploads listed as { id, filename } by id, the newest of each name', () => {
    const { names, uploads } = keptFiles(
      { files: [{ name: 'new.png' }], attachments: [{ id: '20', filename: 'a.png' }, { id: '30', filename: 'a.png' }, { id: '10', filename: 'b.png' }, { id: 'x', filename: 'a.png' }] },
      [{ name: 'old.png' }],
    )

    expect([...names]).toEqual(['new.png'])
    expect([...uploads]).toEqual([
      ['30', 'a.png'],
      ['10', 'b.png'],
    ])
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
  it('names a listed File whose name a newer kept upload takes, and no other', () => {
    const file = (id: string, name: string) => ({ type: ComponentType.File, file: { url: `https://cdn.discordapp.com/attachments/1/${id}/${name}`, attachment_id: id } })
    const payload = {
      components: [file('20', 'a.zip'), { type: ComponentType.Container, components: [file('30', 'a.zip'), file('40', 'b.zip')] }],
      attachments: [{ id: '20', filename: 'a.zip' }, { id: '30', filename: 'a.zip' }, { id: '40', filename: 'b.zip' }],
    }

    expect(shadowedFiles(payload, keptFiles(payload, []))).toEqual(['a.zip'])
    expect(shadowedFiles({ components: payload.components }, keptFiles({}, []))).toEqual([])
  })
})
