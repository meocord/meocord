import 'reflect-metadata'
import { vi } from 'vitest'
import { Client, type GuildMember, type Message } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createMockClient, createMockGuild, createMockMessage } from './mock-interaction.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/**
 * The same messages through the bot, started by the factory, and through `module.dispatch`: each must reach
 * the same handlers with the same params, and send the user the same replies.
 */
const A = '100000000000000001'
const B = '100000000000000002'
const BOT = createMockClient().user.id
const ran: string[] = []

// An entity shows as its ID; one a handler receives still as a ref, with `resolve`, shows marked
const shown = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shown)
    : value && typeof value === 'object' && 'id' in value
      ? `${typeof (value as { resolve?: unknown }).resolve === 'function' ? 'ref' : ''}#${(value as { id: string }).id}`
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shown(item)]))
        : value

@Controller()
class Commands {
  @MessageHandler('pay {to:member} {amount:int} {note...?}')
  pay(_message: Message, params: object) {
    ran.push(`pay ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('balance {who:user?}', { aliases: ['bal'] })
  balance(_message: Message, params: object) {
    ran.push(`balance ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('mute {target:member} {duration:duration?} {reason...?}', { aliases: ['m'], scope: 'guild' })
  mute(_message: Message, params: object) {
    ran.push(`mute ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('purge {count:int} {--bots} {--from:user?}')
  purge(_message: Message, params: object) {
    ran.push(`purge ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('poll {question} {options:string...}')
  poll(_message: Message, params: object) {
    ran.push(`poll ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('inbox', { scope: 'dm' })
  inbox() {
    ran.push('inbox')
  }

  @MessageHandler('config set {key} {value...}', { aliases: ['cfg set'] })
  configSet(_message: Message, params: object) {
    ran.push(`configSet ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('config {key}')
  config(_message: Message, params: object) {
    ran.push(`config ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler('echo {text...}', { prefix: '' })
  echo(_message: Message, params: object) {
    ran.push(`echo ${JSON.stringify(shown(params))}`)
  }

  @MessageHandler()
  listen(message: Message) {
    ran.push(`heard ${message.content}`)
  }
}

@MeoCord({ controllers: [Commands], messages: { prefix: '!', mention: true }, clientOptions: { intents: [] } })
class App {}

const CORPUS: [string, 'guild' | 'dm'][] = [
  [`!pay <@${A}> 25 lunch money`, 'guild'],
  [`!pay <@${A}> lots`, 'guild'],
  ['!pay', 'guild'],
  [`!pay ${A} 3`, 'guild'],
  ['!bal', 'guild'],
  [`!balance <@${B}>`, 'guild'],
  [`!bal <@${B}> extra`, 'guild'],
  [`!m <@${A}> 1h spam`, 'guild'],
  [`!mute <@${A}>`, 'dm'],
  ['!inbox', 'dm'],
  ['!inbox', 'guild'],
  ['!purge 50 --bots', 'guild'],
  [`!purge --from=<@${B}> 20`, 'guild'],
  ['!purge 5 --all', 'guild'],
  ['!purge 5 "--bots"', 'guild'],
  ['!poll "Lunch today?" pizza "fried rice"', 'guild'],
  ['!cfg set prefix ?', 'guild'],
  ['!config set prefix ?', 'guild'],
  ['!config prefix', 'guild'],
  ['!config', 'guild'],
  ['echo hi there', 'guild'],
  [`<@${BOT}> pay <@${A}> 3`, 'guild'],
  [`<@!${BOT}> bal`, 'guild'],
  [`!PAY <@${A}> 3`, 'guild'],
  ['random chatter', 'guild'],
]

const member = (id: string) => ({ id, user: { id } }) as unknown as GuildMember
const messageFor = (content: string, where: 'guild' | 'dm') =>
  createMockMessage({ content, guild: where === 'dm' ? null : createMockGuild({ members: [member(A), member(B)] }) })
const replies = (message: ReturnType<typeof createMockMessage>) =>
  message.reply.mock.calls.map(([reply]) => String((reply).content ?? reply))

describe('module.dispatch and the bot', () => {
  let bot: Client
  const module = MeoCordTestingModule.create({ app: App, controllers: [Commands] }).compile()

  beforeAll(async () => {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(App).start()
    bot = clients[0]
    Object.defineProperty(bot, 'user', { value: { id: BOT, setActivity: () => {} }, configurable: true })
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it.each(CORPUS)('reach the same handlers and send the same replies for %s (%s)', async (content, where) => {
    ran.length = 0
    const sent = messageFor(content, where)
    await Promise.all(bot.rawListeners('messageCreate').map(listener => (listener as (message: unknown) => unknown)(sent)))
    const inBot = { ran: [...ran], replies: replies(sent) }

    ran.length = 0
    const dispatched = messageFor(content, where)
    await module.dispatch(dispatched as unknown as Message)

    expect({ ran: [...ran], replies: replies(dispatched) }).toEqual(inBot)
    // Handlers get members, users and channels, never the refs guards see
    expect(inBot.ran.join('\n')).not.toContain('ref#')
  })
})
