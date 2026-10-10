import { vi } from 'vitest'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  resolveColor,
  TextDisplayBuilder,
} from 'discord.js'
import { Command, Controller, MeoCord, UseTheme } from '@src/decorator/index.js'
import { CooldownError, respond } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const GUILD = '100000000000000001'
const press = (customId: string) => createMockInteraction(ButtonInteraction, { customId })
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const colour = (hex: `#${string}`) => resolveColor(hex)

/** What the first call to a reply method sent. */
const sent = (method: { mock: { calls: unknown[][] } }, call = 0) =>
  method.mock.calls[call][0] as { embeds?: Record<string, unknown>[]; components?: Record<string, unknown>[] }

afterEach(() => vi.restoreAllMocks())

describe('respond() in the theme of the call', () => {
  const builder = new EmbedBuilder().setDescription('built')

  @Controller()
  @UseTheme({ colors: { primary: '#0000A1' } })
  class Answers {
    @Command('embeds', CommandType.BUTTON)
    async embeds(interaction: ButtonInteraction) {
      await respond(interaction).send({ embeds: [{ description: 'plain' }, { description: 'black', color: 0 }, builder] })
      await respond(interaction).followUp({ embeds: [{ description: 'later' }] })
    }

    @Command('containers', CommandType.BUTTON)
    async containers(interaction: ButtonInteraction) {
      const text = new TextDisplayBuilder().setContent('hi')
      await respond(interaction).send({
        components: [
          new ContainerBuilder().addTextDisplayComponents(text),
          { type: ComponentType.Container, accent_color: null, components: [text.toJSON()] },
          { type: ComponentType.ActionRow, components: [] },
        ],
        flags: 1 << 15,
      })
    }

    @Command('around', CommandType.BUTTON)
    async around(interaction: ButtonInteraction) {
      await interaction.reply({ embeds: [{ description: 'around respond()' }] })
    }

    @Command('later', CommandType.BUTTON)
    async later(interaction: ButtonInteraction) {
      await respond(interaction).send('now')
      setTimeout(() => void respond(interaction).followUp({ embeds: [{ description: 'after the call' }] }), 5)
    }
  }

  const module = () => MeoCordTestingModule.create({ controllers: [Answers] }).compile()

  it('fills an embed with no colour with the theme\'s primary, and keeps a colour set, even 0, and the app\'s builder as it was', async () => {
    const interaction = press('embeds')

    await module().invoke(Answers, 'embeds', interaction)

    expect(sent(interaction.update).embeds).toEqual([
      { description: 'plain', color: colour('#0000A1') },
      { description: 'black', color: 0 },
      { description: 'built', color: colour('#0000A1') },
    ])
    expect(builder.data.color).toBeUndefined()
    expect(sent(interaction.followUp).embeds).toEqual([{ description: 'later', color: colour('#0000A1') }])
  })

  it('fills a container with no accent, and keeps a null accent, which means none', async () => {
    const interaction = press('containers')

    await module().invoke(Answers, 'containers', interaction)

    const [built, none, row] = sent(interaction.update).components!
    expect([built.accent_color, none.accent_color, row.accent_color]).toEqual([colour('#0000A1'), null, undefined])
  })

  it('passes on a coloured embed and a component that is not a container as the very objects the app gave', async () => {
    const coloured = new EmbedBuilder().setDescription('coloured').setColor(0x123456)
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('b').setLabel('B').setStyle(ButtonStyle.Primary))
    // Neither needs a colour, so neither is built into JSON here: discord.js builds each once, when it sends
    const built = [vi.spyOn(coloured, 'toJSON'), vi.spyOn(row, 'toJSON')]
    const interaction = press('same')
    // Counted as the call reaches the mock, which builds what it sends as discord.js does
    const update = interaction.update
    let builtBeforeSend: number[] = []
    interaction.update = ((...args: Parameters<typeof update>) => {
      builtBeforeSend = built.map(toJSON => toJSON.mock.calls.length)
      return update(...args)
    }) as typeof update

    @Controller()
    class Same {
      @Command('same', CommandType.BUTTON)
      async same(click: ButtonInteraction) {
        await respond(click).send({ embeds: [coloured], components: [row] } as never)
      }
    }
    await MeoCordTestingModule.create({ controllers: [Same] }).compile().invoke(Same, 'same', interaction)

    const body = update.mock.calls[0][0]
    expect(body.embeds[0]).toBe(coloured)
    expect(body.components[0]).toBe(row)
    expect(builtBeforeSend).toEqual([0, 0])
  })

  it('leaves what is sent around respond() as it is', async () => {
    const interaction = press('around')

    await module().invoke(Answers, 'around', interaction)

    expect(sent(interaction.reply).embeds).toEqual([{ description: 'around respond()' }])
  })

  it('keeps the call\'s theme for a follow-up the call starts and sends after it ends', async () => {
    const interaction = press('later')

    await module().invoke(Answers, 'later', interaction)
    await pause(15)

    expect(sent(interaction.followUp).embeds).toEqual([{ description: 'after the call', color: colour('#0000A1') }])
  })
})

describe('respond() with { fill: false }', () => {
  const container = () => ({ type: ComponentType.Container, components: [new TextDisplayBuilder().setContent('hi').toJSON()] })

  @Controller()
  @UseTheme({ colors: { primary: '#0000D1' } })
  class AsWritten {
    @Command('unfilled', CommandType.BUTTON)
    async unfilled(interaction: ButtonInteraction) {
      await respond(interaction).send({ embeds: [{ description: 'as written' }] }, { fill: false })
      await respond(interaction).edit({ embeds: [{ description: 'edited as written' }] }, { fill: false })
      await respond(interaction).followUp({ components: [container()], flags: 1 << 15 }, { fill: false })
      // Per message: the next one is filled again
      await respond(interaction).followUp({ embeds: [{ description: 'filled' }] })
    }
  }

  it('sends an embed and a container unfilled through send, edit and followUp, and fills the next message', async () => {
    const interaction = press('unfilled')

    await MeoCordTestingModule.create({ controllers: [AsWritten] }).compile().invoke(AsWritten, 'unfilled', interaction)

    expect(sent(interaction.update).embeds).toEqual([{ description: 'as written' }])
    expect(sent(interaction.editReply).embeds).toEqual([{ description: 'edited as written' }])
    expect(sent(interaction.followUp).components).toEqual([container()])
    expect(sent(interaction.followUp, 1).embeds).toEqual([{ description: 'filled', color: colour('#0000D1') }])
  })
})

describe('an error respond() answers', () => {
  @Controller()
  @UseTheme({ colors: { warning: '#0000B1', danger: '#0000B2' } })
  class Failing {
    @Command('cooldown', CommandType.BUTTON)
    cooldown() {
      throw new CooldownError(5_000, 'user')
    }

    @Command('crash', CommandType.BUTTON)
    crash() {
      throw new Error('crash')
    }
  }

  it('takes the warning colour for the user\'s own outcome and the danger colour for a fault', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Failing] }).compile()
    const cooled = press('cooldown')
    const crashed = press('crash')

    await module.dispatch(cooled)
    await module.dispatch(crashed).catch(() => undefined)

    const colourOf = (interaction: ReturnType<typeof press>) =>
      ((interaction.reply.mock.calls[0]?.[0]))?.embeds?.[0]?.color
    expect([colourOf(cooled), colourOf(crashed)]).toEqual([colour('#0000B1'), colour('#0000B2')])
  })
})

describe('respond() outside any call', () => {
  it('takes the theme of the app the interaction came to, with its server\'s theme, as a collector\'s callback does', async () => {
    @Controller()
    class Nothing {
      @Command('nothing', CommandType.BUTTON)
      nothing() {}
    }
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    @MeoCord({
      controllers: [Nothing],
      clientOptions: { intents: [] },
      theme: { colors: { info: '#0000C1' } },
      themeFor: { guild: async ({ guild }) => (guild.id === GUILD ? { colors: { primary: '#0000C2' } } : undefined) },
    })
    class Bot {}
    await MeoCordFactory.create(Bot).start()
    const click = press('collected')
    Object.defineProperty(click, 'client', { value: clients[0] })
    Object.assign(click, { guildId: GUILD })

    // As a collector's collect callback runs: in the client's event, outside any call's theme
    await respond(click).send({ embeds: [{ description: 'collected' }] })

    expect(sent(click.update).embeds).toEqual([{ description: 'collected', color: colour('#0000C2') }])
    expect(DEFAULT_THEME.colors.primary).not.toBe('#0000C2')
  })
})
