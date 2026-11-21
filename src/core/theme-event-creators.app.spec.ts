import * as djs from 'discord.js'
import { Client, Events as ClientEvent } from 'discord.js'
import { vi } from 'vitest'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { Controller, MeoCord, On } from '@src/decorator/index.js'
import { useTheme } from '@src/common/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

// A started bot tells the theme which event an @On handler takes, so a sticker's creator themes only its create event

const HOME = '100000000000000001'
const ADA = '200000000000000001'
const CREATOR = '#0000E3'

const seen: [string, string][] = []

@Controller()
class Stickers {
  @On(ClientEvent.GuildStickerCreate)
  created() {
    seen.push([ClientEvent.GuildStickerCreate, String(useTheme().colors.primary).toUpperCase()])
  }

  @On(ClientEvent.GuildStickerUpdate)
  updated() {
    seen.push([ClientEvent.GuildStickerUpdate, String(useTheme().colors.primary).toUpperCase()])
  }
}

@MeoCord({ controllers: [Stickers], clientOptions: { intents: [] }, themeFor: { user: ({ user }) => (user.id === ADA ? { colors: { primary: CREATOR } } : undefined) } })
class App {}

afterEach(() => vi.restoreAllMocks())

it("runs a sticker's create handler in its creator's theme, and its update handler in none", async () => {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  const app = MeoCordFactory.create(App)
  await app.start()
  const [bot] = clients
  const guild = (bot.guilds as unknown as { _add: (data: object) => djs.Guild })._add({ id: HOME, name: 'g', icon: null, owner_id: ADA, roles: [], emojis: [], stickers: [], features: [] })
  const sticker = new (djs.Sticker as unknown as new (client: Client, data: object) => djs.Sticker)(bot, {
    id: '700000000000000009',
    name: 's',
    tags: 't',
    type: 2,
    format_type: 1,
    guild_id: guild.id,
    available: true,
    user: { id: ADA, username: 'ada', discriminator: '0', avatar: null, global_name: null },
  })

  bot.emit(ClientEvent.GuildStickerCreate, sticker)
  bot.emit(ClientEvent.GuildStickerUpdate, sticker, sticker)

  await vi.waitFor(() => expect(seen).toHaveLength(2))
  // The create call waits for the creator's theme, so the update call may finish first
  expect(Object.fromEntries(seen)).toEqual({
    [ClientEvent.GuildStickerCreate]: CREATOR,
    [ClientEvent.GuildStickerUpdate]: String(DEFAULT_THEME.colors.primary).toUpperCase(),
  })
  await app.stop()
})
