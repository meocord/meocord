import 'reflect-metadata'
import { AutoModerationRule, Collection, GuildEmoji, GuildScheduledEvent, Invite, Sticker, TextChannel } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { createMockChannel, createMockGuild, createMockMessage } from './mock-interaction.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const ID = '1400000000000000777'

// The managers a guild has beside members, channels, roles and bans, with the class each holds
const CACHING = [
  ['emojis', GuildEmoji],
  ['stickers', Sticker],
  ['scheduledEvents', GuildScheduledEvent],
  ['autoModerationRules', AutoModerationRule],
] as const

describe.each([
  ['default', () => {}],
  ['strict', () => useStrictMocks()],
])("a mock guild's emoji, sticker, scheduled event, AutoMod rule and invite managers, in %s mode", (_mode, setUp) => {
  beforeEach(() => setUp())

  it.each(CACHING)("%s.create() resolves its item in the guild and caches it, as discord.js's does", async (key, Item) => {
    const guild = createMockGuild()
    const manager = guild[key] as unknown as { create(options: object): Promise<{ id: string; guild: unknown }>; cache: Collection<string, unknown> }

    const made = await manager.create({ name: 'made' })

    expect([made, made.guild, manager.cache.get(made.id)]).toEqual([expect.any(Item), guild, made])
  })

  it.each([...CACHING, ['invites', Invite]] as const)('%s.fetch(id) finds the cached item, or makes and caches one; a list fetch is empty', async (key, Item) => {
    const guild = createMockGuild()
    const manager = guild[key] as unknown as {
      fetch(id?: string): Promise<unknown>
      cache: Collection<string, unknown>
      resolve(idOrItem: unknown): unknown
    }

    const fetched = await manager.fetch(ID)

    expect([fetched, manager.cache.get(ID), manager.resolve(ID), manager.resolve(fetched), await manager.fetch(ID)]).toEqual([expect.any(Item), fetched, fetched, fetched, fetched])
    expect(await manager.fetch()).toEqual(new Collection())
  })

  it("invites.create() resolves an invite to the channel in the guild, keyed by its code, and caches nothing, as discord.js's does", async () => {
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel, { guild } as never)

    const invite = await guild.invites.create(channel, { maxAge: 0 })

    expect([invite, typeof invite.code, invite.guild, invite.channel, guild.invites.cache.size]).toEqual([expect.any(Invite), 'string', guild, channel, 0])
    expect((await guild.invites.fetch(invite.code)).code).toBe(invite.code)
  })

  it("are a message's guild's too", async () => {
    const { guild } = createMockMessage()

    const emoji = await guild!.emojis.create({ attachment: 'emoji.png', name: 'party' })

    expect([emoji, guild!.emojis.cache.get(emoji.id), guild!.invites.cache.size]).toEqual([expect.any(GuildEmoji), emoji, 0])
  })
})
