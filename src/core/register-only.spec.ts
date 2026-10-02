import { vi } from 'vitest'

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
      info = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

const { rest, mockLoadConfig } = vi.hoisted(() => ({
  rest: { get: vi.fn(), put: vi.fn(), setToken: vi.fn() },
  mockLoadConfig: vi.fn(),
}))

// The standalone REST client `meocord register` uses; the token is never sent to a gateway.
vi.mock('discord.js', async original => ({
  ...(await original<typeof import('discord.js')>()),
  REST: vi.fn(
    class {
      constructor() {
        rest.setToken.mockReturnValue(this)
        return Object.assign(this, rest)
      }
    },
  ),
}))

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: mockLoadConfig }))

const { Container } = await import('inversify')
const { Logger } = await import('@src/common/index.js')
const { Command, Controller } = await import('@src/decorator/index.js')
const { CommandType, MetadataKey } = await import('@src/enum/index.js')
const { MeoCordApp } = await import('@src/core/meocord.app.js')

class PingBuilder {
  build = () => ({ toJSON: () => ({ name: 'ping', type: 1, description: 'Pong' }) }) as any
}
Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, PingBuilder)

@Controller()
class PingController {
  @Command('ping', PingBuilder as any)
  async ping(..._args: any[]) {}
}

describe('MeoCordApp.start() in register-only mode', () => {
  const client = { login: vi.fn(), on: vi.fn() }
  let exit: ReturnType<typeof vi.spyOn>

  const start = () => new MeoCordApp([PingController] as any, new Container(), client as any, 'the-token').start()

  beforeEach(() => {
    process.env.MEOCORD_REGISTER_ONLY = '1'
    rest.get.mockResolvedValue({ id: 'app-id' })
    rest.put.mockResolvedValue([])
    mockLoadConfig.mockReturnValue({ discordToken: 'the-token' })
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    delete process.env.MEOCORD_REGISTER_ONLY
    delete process.env.MEOCORD_REGISTER_GUILD
    vi.clearAllMocks()
    exit.mockRestore()
  })

  it('registers over REST with the token and exits 0, without logging in', async () => {
    await start()

    expect(rest.setToken).toHaveBeenCalledWith('the-token')
    expect(rest.put).toHaveBeenCalledWith('/applications/app-id/commands', { body: [{ name: 'ping', type: 1, description: 'Pong' }] })
    expect(client.login).not.toHaveBeenCalled()
    expect(client.on).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('registers even when startup registration is off', async () => {
    mockLoadConfig.mockReturnValue({ discordToken: 'the-token', commands: { register: false } })

    await start()

    expect(rest.put).toHaveBeenCalled()
  })

  it('sends everything to the guild it is given', async () => {
    process.env.MEOCORD_REGISTER_GUILD = 'guild-id'

    await start()

    expect(rest.put).toHaveBeenCalledWith('/applications/app-id/guilds/guild-id/commands', expect.anything())
  })

  it('exits 1, naming the token, when the application cannot be read', async () => {
    rest.get.mockRejectedValue(new Error('401: Unauthorized'))
    exit.mockImplementation((() => {
      throw new Error('exited')
    }) as never)

    await expect(start()).rejects.toThrow('exited')

    expect(exit).toHaveBeenCalledWith(1)
    expect(rest.put).not.toHaveBeenCalled()
    const error = vi.mocked(Logger).mock.results.at(-1)?.value.error
    expect(error).toHaveBeenCalledWith(expect.stringContaining('check discordToken'), expect.any(Error))
  })

  it('exits 1, saying Discord refused the token and where to get a new one, when it answers 401', async () => {
    const unauthorized = Object.assign(new Error('401: Unauthorized'), { status: 401 })
    rest.get.mockRejectedValue(unauthorized)
    exit.mockImplementation((() => {
      throw new Error('exited')
    }) as never)

    await expect(start()).rejects.toThrow('exited')

    expect(exit).toHaveBeenCalledWith(1)
    const logger = vi.mocked(Logger).mock.results.at(-1)?.value
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/^Discord refused the bot token\. .*Reset Token/))
    expect(logger.debug).toHaveBeenCalledWith(expect.any(String), unauthorized)
  })

  it('exits 1 before asking Discord anything when the token is missing', async () => {
    exit.mockImplementation((() => {
      throw new Error('exited')
    }) as never)

    await expect(new MeoCordApp([PingController] as any, new Container(), client as any, '').start()).rejects.toThrow('exited')

    expect(exit).toHaveBeenCalledWith(1)
    expect(rest.get).not.toHaveBeenCalled()
    const error = vi.mocked(Logger).mock.results.at(-1)?.value.error
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Discord token is missing: meocord\.config\.ts sets discordToken/))
  })

  it('exits 1 when Discord rejects the commands', async () => {
    rest.put.mockRejectedValue(new Error('Invalid Form Body'))

    await start()

    expect(exit).toHaveBeenCalledWith(1)
  })
})
