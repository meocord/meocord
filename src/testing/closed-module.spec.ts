import { ChatInputCommandInteraction, type GuildMember } from 'discord.js'
import { Command, Controller, On } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { Logger } from '@src/common/logger.js'
import { createMock, createMockInteraction, MeoCordTestingModule } from './index.js'

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  async ping(interaction: ChatInputCommandInteraction) {
    await interaction.reply('pong')
  }

  @On('guildMemberAdd')
  greet(_member: GuildMember) {}
}

const CLOSED =
  'This testing module is closed, and its services have shut down, so dispatch, invoke and emit run against shut-down ' +
  'state. Close it after the last call, in afterEach.'

let warned: string[]
beforeEach(() => {
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())

const ping = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

describe('a closed testing module', () => {
  it('warns once that it is closed when asked to dispatch, invoke or emit, and still runs each', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Ping] }).compile()
    await module.init({ ready: true })
    await module.close()
    const dispatched = ping()

    const results = [
      await module.dispatch(dispatched),
      await module.invoke(Ping, 'ping', ping()),
      await module.emit('guildMemberAdd', createMock<GuildMember>()),
    ]

    expect(results.map(result => ('ran' in result ? result.ran : undefined))).toEqual([true, true, 1])
    expect(dispatched.reply).toHaveBeenCalledWith('pong')
    expect(warned).toEqual([CLOSED])
  })

  it('says nothing before close(), and each module warns for itself', async () => {
    const open = MeoCordTestingModule.create({ controllers: [Ping] }).compile()
    await open.dispatch(ping())
    expect(warned).toEqual([])

    for (const module of [MeoCordTestingModule.create({ controllers: [Ping] }).compile(), MeoCordTestingModule.create({ controllers: [Ping] }).compile()]) {
      await module.close()
      await module.dispatch(ping())
    }

    expect(warned).toEqual([CLOSED, CLOSED])
  })
})
