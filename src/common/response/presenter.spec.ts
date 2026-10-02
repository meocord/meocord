import { ChatInputCommandInteraction, ComponentType, resolveColor } from 'discord.js'
import { Command, Controller, MeoCord, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PresentedError, type ResponsePresenter } from '@src/interface/index.js'
import { Theme } from '@src/common/theme.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { defaultPresenter, renderContainer, renderEmbed, RENDERED_CONTAINER_ID, withoutFiles } from '@src/common/response/presenter.js'
import { respond } from '@src/common/response/response-state.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

describe('the default presenter', () => {
  const theme = { ...DEFAULT_THEME, emojis: { ...DEFAULT_THEME.emojis, loading: '⌛' } }
  const context = { interaction: createMockInteraction(ChatInputCommandInteraction), locale: 'en-US', mode: 'embed' as const, theme }

  it('loads with "Working on it…", the theme\'s loading emoji and its primary colour', () => {
    expect(renderEmbed(defaultPresenter.loading(context))).toEqual({
      description: '⌛ Working on it…',
      color: resolveColor(DEFAULT_THEME.colors.primary),
    })
  })

  it('shows errors under "Oops!" in the colour of their tone: danger for a fault, warning for the user\'s own outcome', () => {
    expect(renderEmbed(defaultPresenter.error(context, { message: 'Nope.', error: new Error(), tone: 'danger' }))).toEqual({
      title: 'Oops!',
      description: 'Nope.',
      color: resolveColor(DEFAULT_THEME.colors.danger),
    })
    expect(renderEmbed(defaultPresenter.error(context, { message: 'Slow down.', error: new Error(), tone: 'warning' }))).toEqual({
      title: 'Oops!',
      description: 'Slow down.',
      color: resolveColor(DEFAULT_THEME.colors.warning),
    })
  })

  it('renders a Components V2 container with the heading, text and extra components', () => {
    const container = renderContainer({
      title: 'Oops!',
      text: 'Nope.',
      color: Theme.errorColor,
      components: [{ type: ComponentType.Separator }],
    })

    expect(container).toMatchObject({
      type: ComponentType.Container,
      id: RENDERED_CONTAINER_ID,
      accent_color: resolveColor(Theme.errorColor),
      components: [{ type: ComponentType.TextDisplay, content: '### Oops!\nNope.' }, { type: ComponentType.Separator }],
    })
  })
})

@Service()
class Branding {
  readonly name = 'Brand'
}

@Service()
class BrandPresenter implements ResponsePresenter {
  constructor(private readonly branding: Branding) {}

  loading() {
    return { text: `${this.branding.name} is working…` }
  }

  error(_context: unknown, { message }: PresentedError) {
    return { title: this.branding.name, text: message }
  }
}

@Controller()
class FailingController {
  @Command('fail', CommandType.SLASH)
  async fail(interaction: ChatInputCommandInteraction) {
    await respond(interaction).error(new Error('x'), { message: 'Broken.' })
  }
}

@MeoCord({ controllers: [FailingController], clientOptions: { intents: [] }, presenter: BrandPresenter })
class App {}

describe('@MeoCord({ presenter })', () => {
  it('styles respond() answers with the app presenter, resolved with its dependencies', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [FailingController] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction)

    await module.invoke(FailingController, 'fail', interaction)

    // The presenter gave no colour, so the view takes the theme's primary
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [{ title: 'Brand', description: 'Broken.', color: resolveColor(DEFAULT_THEME.colors.primary) }] }),
    )
  })
})

describe('renderContainer and renderEmbed', () => {
  it('give a view without a colour no colour', () => {
    expect(renderContainer({ text: 'plain' })).not.toHaveProperty('accent_color')
    expect(renderEmbed({ text: 'plain' })).not.toHaveProperty('color')
  })
})

describe("a view's image and thumbnail", () => {
  const files = [
    { name: 'card.png', data: Buffer.from('p') },
    { name: 'badge.png', data: Buffer.from('p') },
  ]

  it('take a file by name, or a URL, in place of the first image in an embed', () => {
    expect(renderEmbed({ text: 't', files, image: 'badge.png', thumbnail: 'https://example.com/a.png' })).toMatchObject({
      image: { url: 'attachment://badge.png' },
      thumbnail: { url: 'https://example.com/a.png' },
    })
  })

  it('give the embed image the first image file the thumbnail does not take', () => {
    expect(renderEmbed({ text: 't', files, thumbnail: 'card.png' })).toMatchObject({
      image: { url: 'attachment://badge.png' },
      thumbnail: { url: 'attachment://card.png' },
    })
  })

  it('put the thumbnail beside the text, and the image first in the gallery, in a container', () => {
    const container = renderContainer({ title: 'Cooldown', text: 't', files, thumbnail: 'card.png', image: 'https://example.com/b.png' })

    expect(container.components).toMatchObject([
      {
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: '### Cooldown\nt' }],
        accessory: { type: ComponentType.Thumbnail, media: { url: 'attachment://card.png' } },
      },
      {
        type: ComponentType.MediaGallery,
        items: [{ media: { url: 'https://example.com/b.png' } }, { media: { url: 'attachment://badge.png' } }],
      },
    ])
  })
})

// Discord refuses a gallery of more than 10, and the image beside the most files a message takes makes 11
describe('a view with more images than one gallery holds', () => {
  it('shows them in galleries of 10, in order, the image first', () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ name: `shot-${index}.png`, data: Buffer.from('') }))

    const container = renderContainer({ text: 't', files, image: 'https://example.com/banner.png' })

    const galleries = container.components.filter(component => component.type === ComponentType.MediaGallery)
    expect(galleries.map(gallery => gallery.items.length)).toEqual([10, 1])
    expect(galleries.flatMap(gallery => gallery.items.map(item => item.media.url))).toEqual([
      'https://example.com/banner.png',
      ...files.map(file => `attachment://${file.name}`),
    ])
  })
})

describe("a view's files its components show", () => {
  it('are told apart by their whole URL, so a longer name that starts the same shows nothing of the view', () => {
    const container = renderContainer({
      text: 't',
      files: [{ name: 'a.png', data: Buffer.from('p') }],
      components: [{ type: ComponentType.File, file: { url: 'attachment://a.png.bak' } }],
    })

    expect(container.components).toContainEqual({ type: ComponentType.MediaGallery, items: [{ media: { url: 'attachment://a.png' } }] })
  })
})

describe('a view sent without its files', () => {
  it('loses the image and thumbnail that named them, keeping one given as a URL', () => {
    const view = { text: 't', files: [{ name: 'card.png', data: Buffer.from('p') }], image: 'card.png', thumbnail: 'https://example.com/t.png' }

    expect(withoutFiles(view)).toEqual({ text: 't', thumbnail: 'https://example.com/t.png' })
  })
})
