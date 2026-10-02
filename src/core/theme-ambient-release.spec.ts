import { vi } from 'vitest'
import { Client } from 'discord.js'
import { Command, Controller, MeoCord, Service } from '@src/decorator/index.js'
import { type OnShutdown } from '@src/interface/index.js'
import { useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

@Controller()
class Plain {
  @Command('plain', CommandType.BUTTON)
  plain() {}
}

// A file of its own: which app's theme is read outside calls is one value for the whole process
describe('the theme read outside calls', () => {
  it('goes to the app that comes online, not one whose login was refused, and back to the defaults once it shuts down', async () => {
    const login = vi
      .spyOn(Client.prototype, 'login')
      .mockRejectedValueOnce(Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' }))
    vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0F0F02' } } })
    class Refused {}
    await MeoCordFactory.create(Refused).start().catch(() => {})
    process.exitCode = undefined

    login.mockResolvedValue('token')
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0F0F03' } } })
    class Running {}
    const app = MeoCordFactory.create(Running)
    await app.start()
    const online = useTheme().colors.primary
    await (Reflect.get(app, 'close') as () => Promise<boolean>)()

    expect([online, useTheme().colors.primary]).toEqual(['#0F0F03', DEFAULT_THEME.colors.primary])
  })

  // A failed login gives the theme up, so the retry that comes online has to take it again
  it('goes back to an app that comes online when it retries after a failed login', async () => {
    vi.spyOn(Client.prototype, 'login').mockRejectedValueOnce(new Error('gateway unreachable (stand-in)')).mockResolvedValue('token')
    vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
    @MeoCord({ controllers: [Plain], clientOptions: { intents: [] }, theme: { colors: { primary: '#0F0F04' } } })
    class Retried {}
    const app = MeoCordFactory.create(Retried)
    await app.start().catch(() => {})
    process.exitCode = undefined

    await app.start()
    const online = useTheme().colors.primary
    await (Reflect.get(app, 'close') as () => Promise<boolean>)()

    expect(online).toBe('#0F0F04')
  })

  // Given up after the calls under way and the hooks, so onShutdown reads the app's theme as onReady does
  it("is still the app's while its onShutdown hooks run", async () => {
    vi.spyOn(Client.prototype, 'login').mockResolvedValue('token')
    vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
    const seen: unknown[] = []
    @Service()
    class Closer implements OnShutdown {
      onShutdown() {
        seen.push(useTheme().colors.primary)
      }
    }
    @MeoCord({ controllers: [Plain], services: [Closer], clientOptions: { intents: [] }, theme: { colors: { primary: '#0F0F05' } } })
    class Closing {}
    const app = MeoCordFactory.create(Closing)
    await app.start()
    const bot = Reflect.get(app, 'bot') as Client
    await Promise.all(bot.listeners('clientReady').map(listener => listener(bot)))

    await (Reflect.get(app, 'close') as () => Promise<boolean>)()

    expect([seen, useTheme().colors.primary]).toEqual([['#0F0F05'], DEFAULT_THEME.colors.primary])
  })
})
