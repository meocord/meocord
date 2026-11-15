import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { ButtonInteraction, resolveColor } from 'discord.js'
import { Command, Controller, MeoCord, MessageHandler, UseTheme } from '@src/decorator/index.js'
import { bindTheme, Logger, respond, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const GUILD = '100000000000000001'
const OTHER_GUILD = '100000000000000002'
const ADA = '200000000000000001'
const BEN = '200000000000000002'

const seen: unknown[] = []
const theme = () => [useTheme().colors.primary, useTheme().colors.info]
const colour = (primary: `#${string}`): ThemeOverride => ({ colors: { primary } })
const pause = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

/** A message sent by `userId`. */
function sent(content: string, userId: string) {
  const message = createMockMessage({ content })
  Object.assign(message.author, { id: userId })
  return message
}

/** A button pressed by `userId` in `guildId`, on `client` when given, as clicks on one bot share its client. */
function press(customId: string, { guildId = GUILD, userId = ADA, client }: { guildId?: string; userId?: string; client?: object } = {}) {
  const interaction = createMockInteraction(ButtonInteraction, { customId })
  Object.assign(interaction, { guildId })
  Object.assign(interaction.user, { id: userId })
  if (client) Object.defineProperty(interaction, 'client', { value: client })
  return interaction
}

/** What the first reply method a click answered with sent. */
const sentColour = (click: ButtonInteraction) => {
  const [call] = [click.update, click.reply].flatMap(method => (method as unknown as { mock: { calls: unknown[][] } }).mock.calls)
  return (call[0] as { embeds: { color?: number }[] }).embeds[0].color
}

/** Stands in for a collector: the handler binds its listener to it, and each test emits what Discord would. */
let collector: EventEmitter

@Controller()
@UseTheme({ colors: { info: '#0000A1' } })
class Poll {
  @Command('poll', CommandType.BUTTON)
  poll() {
    collector.on('collect', bindTheme((click: ButtonInteraction) => void seen.push(['collect', click.user.id, ...theme()])))
    collector.on('answer', bindTheme(async (click: ButtonInteraction) => {
      seen.push(['answer', click.user.id, ...theme()])
      await respond(click).send({ embeds: [{ description: 'Picked' }] })
      seen.push(['answered', click.user.id, ...theme()])
    }))
    collector.on('end', bindTheme((_collected: Map<string, unknown>, reason: string) => void seen.push(['end', reason, ...theme()])))
    collector.on('nest', bindTheme(() => {
      collector.on('nested', bindTheme((click: ButtonInteraction) => void seen.push(['nested', click.user.id, ...theme()])))
    }))
  }
}

@Controller()
class Plain {
  @Command('plain', CommandType.BUTTON)
  plain() {
    collector.on('collect', bindTheme((click: ButtonInteraction) => void seen.push(['collect', click.user.id, ...theme()])))
  }

  @MessageHandler('watch')
  watch() {
    collector.on('message', bindTheme((message: { author: { id: string } }) => void seen.push(['message', message.author.id, ...theme()])))
  }
}

/** A testing module whose app looks themes up with `themeFor`. */
function moduleWith(themeFor: ThemeResolvers, controllers: any[] = [Poll], theme?: ThemeOverride) {
  @MeoCord({ controllers, clientOptions: { intents: [] }, themeFor, theme })
  class App {}
  return MeoCordTestingModule.create({ app: App, controllers }).compile()
}

const byUser: ThemeResolvers = { user: ({ user }) => colour(user.id === ADA ? '#00000A' : '#00000B') }

beforeEach(() => {
  seen.length = 0
  collector = new EventEmitter()
})
afterEach(() => vi.restoreAllMocks())

describe('a listener bindTheme wraps, with themeFor', () => {
  it('answers each member who clicks in their own theme, over the handler\'s @UseTheme', async () => {
    const module = moduleWith(byUser)
    await module.invoke(Poll, 'poll', press('poll'))
    collector.emit('collect', press('pick'))
    collector.emit('collect', press('pick', { userId: BEN }))
    await pause()
    collector.emit('collect', press('pick', { userId: BEN }))

    expect(seen).toEqual([
      ['collect', ADA, '#00000A', '#0000A1'],
      // Ben's theme is still being looked up: the handler's, without Ada's
      ['collect', BEN, DEFAULT_THEME.colors.primary, '#0000A1'],
      ['collect', BEN, '#00000B', '#0000A1'],
    ])
  })

  it('answers another server, from a listener bound in one server\'s call, in that server\'s theme', async () => {
    const module = moduleWith({ guild: ({ guild }) => colour(guild.id === GUILD ? '#00000C' : '#00000D') })
    await module.invoke(Poll, 'poll', press('poll'))
    collector.emit('collect', press('pick', { guildId: OTHER_GUILD }))
    await pause()
    collector.emit('collect', press('pick', { guildId: OTHER_GUILD }))
    collector.emit('collect', press('pick'))

    expect(seen.slice(1)).toEqual([
      ['collect', ADA, '#00000D', '#0000A1'],
      ['collect', ADA, '#00000C', '#0000A1'],
    ])
  })

  it('answers with respond() once a theme still being looked up is found, and runs on in it', async () => {
    let found: (layer: ThemeOverride) => void = () => {}
    const module = moduleWith({ user: ({ user }) => (user.id === ADA ? colour('#00000A') : new Promise<ThemeOverride>(resolve => (found = resolve))) })
    await module.invoke(Poll, 'poll', press('poll'))
    const click = press('pick', { userId: BEN })
    collector.emit('answer', click)
    await pause()
    found(colour('#00000B'))
    await pause()

    expect(seen).toEqual([
      ['answer', BEN, DEFAULT_THEME.colors.primary, '#0000A1'],
      ['answered', BEN, '#00000B', '#0000A1'],
    ])
    expect(sentColour(click)).toBe(resolveColor('#00000B'))
  })

  it('leaves out a theme themeFor gives that is not valid, warning as a call does', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const module = moduleWith({ user: ({ user }) => (user.id === ADA ? colour('#00000A') : { colors: { primary: 'red' as never } }) })
    await module.invoke(Poll, 'poll', press('poll'))
    collector.emit('collect', press('pick', { userId: BEN }))
    await pause()
    collector.emit('collect', press('pick', { userId: BEN }))

    expect(seen.at(-1)).toEqual(['collect', BEN, DEFAULT_THEME.colors.primary, '#0000A1'])
    const warnings = warn.mock.calls.filter(([text]) => String(text).includes(`themeFor.user for user ${BEN}`))
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('theme.colors.primary')
  })

  it('rebuilds the theme of a listener bound inside a bound listener, from the handler\'s', async () => {
    const module = moduleWith(byUser)
    await module.invoke(Poll, 'poll', press('poll'))
    collector.emit('nest', press('nest'))
    collector.emit('nested', press('pick', { userId: BEN }))
    await pause()
    collector.emit('nested', press('pick', { userId: BEN }))

    expect(seen.at(-1)).toEqual(['nested', BEN, '#00000B', '#0000A1'])
  })

  it('runs a call given no interaction or message in the whole theme of the call that bound it', async () => {
    const module = moduleWith(byUser)
    await module.invoke(Poll, 'poll', press('poll'))
    collector.emit('end', new Map(), 'time')

    expect(seen).toEqual([['end', 'time', '#00000A', '#0000A1']])
  })

  it('rebuilds for a message\'s author, as for a click\'s member', async () => {
    const module = moduleWith(byUser, [Plain])
    await module.invoke(Plain, 'watch', sent('watch', ADA))
    collector.emit('message', sent('hi', BEN))
    await pause()
    collector.emit('message', sent('hi', BEN))

    expect(seen.at(-1)).toEqual(['message', BEN, '#00000B', DEFAULT_THEME.colors.info])
  })

  it('rebuilds when the binding call needed no scope of its own, its app owning the theme outside calls', async () => {
    const resolvers: ThemeResolvers = { user: ({ user }) => (user.id === BEN ? colour('#00000B') : undefined) }
    const module = await moduleWith(resolvers, [Plain], { colors: { info: '#0000A2' } }).init({ ready: true })
    const first = press('plain')
    await module.invoke(Plain, 'plain', first)
    collector.removeAllListeners()
    // Ada's lookup is cached now, so her call has nothing over the app's theme and enters no scope
    await module.invoke(Plain, 'plain', press('plain', { client: first.client }))
    collector.emit('collect', press('pick', { userId: BEN, client: first.client }))
    await pause()
    collector.emit('collect', press('pick', { userId: BEN, client: first.client }))

    expect(seen.at(-1)).toEqual(['collect', BEN, '#00000B', '#0000A2'])
    await module.close()
  })
})

describe('a listener bindTheme wraps, in the other build of this version', () => {
  it('rebuilds each call\'s theme from the call that bound it', async () => {
    vi.resetModules()
    const other = await import('@src/common/index.js')
    @Controller()
    @UseTheme({ colors: { info: '#0000A1' } })
    class OtherPoll {
      @Command('poll', CommandType.BUTTON)
      poll() {
        collector.on('collect', other.bindTheme((click: ButtonInteraction) => void seen.push(['collect', click.user.id, ...theme()])))
      }
    }
    const module = moduleWith(byUser, [OtherPoll])
    await module.invoke(OtherPoll, 'poll', press('poll'))
    collector.emit('collect', press('pick', { userId: BEN }))
    await pause()
    collector.emit('collect', press('pick', { userId: BEN }))

    expect(other.bindTheme).not.toBe(bindTheme)
    expect(seen.at(-1)).toEqual(['collect', BEN, '#00000B', '#0000A1'])
  })
})
