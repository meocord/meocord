import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as djs from 'discord.js'
import { ButtonInteraction, ChannelType, Client, Collection } from 'discord.js'
import { Command, Controller, MeoCord, On, Once, UseTheme } from '@src/decorator/index.js'
import { bindTheme, Logger, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { themeTargets } from '@src/core/theme-resolvers.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockGuild, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// The server and user a call is themed for, from the arguments discord.js gives each event

const HOME = '100000000000000001'
const AWAY = '100000000000000002'
const ADA = '200000000000000001'
const BEN = '200000000000000002'
const CHANNEL = '300000000000000001'
const THREAD = '300000000000000009'

// Real structures, made as the client makes them, on a client that never logs in
const client = new Client({ intents: [] })
/** Adds raw data to a discord.js cache, as the client does for what the gateway sends. */
const add = <T>(manager: object, ...args: unknown[]): T => (manager as { _add: (...data: unknown[]) => T })._add(...args)
const guildData = (id: string) => ({ id, name: 'g', icon: null, owner_id: ADA, roles: [], emojis: [], stickers: [], features: [] })
const userData = (id: string) => ({ id, username: 'u', discriminator: '0', avatar: null, global_name: null })
add(client.guilds, guildData(HOME))
const away = add<djs.Guild>(client.guilds, guildData(AWAY))
add(client.users, userData(ADA))
const ben = add<djs.User>(client.users, userData(BEN))
const channel = add<djs.TextChannel>(client.channels, { id: CHANNEL, type: ChannelType.GuildText, guild_id: AWAY, name: 'c', position: 0, permission_overwrites: [] }, away)
const thread = add<djs.ThreadChannel>(
  client.channels,
  { id: THREAD, type: ChannelType.PublicThread, guild_id: AWAY, parent_id: CHANNEL, name: 't', thread_metadata: { archived: false, auto_archive_duration: 60, archive_timestamp: new Date().toISOString(), locked: false } },
  away,
)
const role = add<djs.Role>(away.roles, { id: '400000000000000001', name: 'r', color: 0, hoist: false, position: 1, permissions: '0', managed: false, mentionable: false })
const member = add<djs.GuildMember>(away.members, { user: userData(BEN), roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false })
const make = <T>(name: string, ...args: unknown[]): T => new (djs as unknown as Record<string, new (...a: unknown[]) => T>)[name](...args)
const message = () =>
  add<djs.Message>(channel.messages, { id: '500000000000000001', channel_id: CHANNEL, guild_id: AWAY, author: userData(BEN), content: 'x', timestamp: new Date().toISOString(), edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, type: 0 })
const presence = () => add<djs.Presence>(away.presences, { user: { id: BEN }, guild_id: AWAY, guild: away, status: 'online', activities: [], client_status: {} })
const rule = () => make('AutoModerationRule', client, { id: '700000000000000005', guild_id: AWAY, name: 'am', creator_id: ADA, event_type: 1, trigger_type: 1, trigger_metadata: {}, actions: [], enabled: true, exempt_roles: [], exempt_channels: [] }, away)
const entitlement = () => make('Entitlement', client, { id: '700000000000000007', sku_id: '1', application_id: '1', user_id: BEN, guild_id: AWAY, type: 8, deleted: false, starts_at: null, ends_at: null })
const sound = () => make('SoundboardSound', client, { sound_id: '700000000000000003', name: 'snd', volume: 1, emoji_id: null, emoji_name: null, guild_id: AWAY, available: true, user: userData(ADA) })
const stage = () => make('StageInstance', client, { id: '700000000000000006', guild_id: AWAY, channel_id: CHANNEL, topic: 't', privacy_level: 2, discoverable_disabled: true, guild_scheduled_event_id: null })
const subscription = () => make('Subscription', client, { id: '700000000000000008', user_id: BEN, sku_ids: [], entitlement_ids: [], current_period_start: new Date().toISOString(), current_period_end: new Date().toISOString(), status: 0, canceled_at: null })
const scheduled = () => make('GuildScheduledEvent', client, { id: '700000000000000004', guild_id: AWAY, channel_id: CHANNEL, creator_id: ADA, name: 'ev', scheduled_start_time: new Date().toISOString(), privacy_level: 2, status: 1, entity_type: 2 })
const threadMember = () => make('ThreadMember', thread, { id: THREAD, user_id: BEN, join_timestamp: new Date().toISOString(), flags: 0 })
const pollAnswer = () => {
  const poll = make<djs.Poll>('Poll', client, { question: { text: 'q' }, answers: [{ answer_id: 1, poll_media: { text: 'a' } }], expiry: new Date().toISOString(), allow_multiselect: false, layout_type: 1 }, message(), channel)
  return poll.answers.get(1)
}
const dmChannel = () => add<djs.DMChannel>(client.channels, { id: '300000000000000005', type: ChannelType.DM, recipients: [userData(BEN)] })
/** A poll answer in a direct message, whose message's guildId is null. */
const dmPollAnswer = () => {
  const dm = dmChannel()
  const sent = add<djs.Message>(dm.messages, { id: '500000000000000002', channel_id: dm.id, author: userData(BEN), content: 'x', timestamp: new Date().toISOString(), edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, type: 0 })
  const poll = make<djs.Poll>('Poll', client, { question: { text: 'q' }, answers: [{ answer_id: 1, poll_media: { text: 'a' } }], expiry: new Date().toISOString(), allow_multiselect: false, layout_type: 1 }, sent, dm)
  return poll.answers.get(1)
}
/** A server whose id reads are counted. */
const countedGuild = () => {
  const reads = { id: 0 }
  const guild = Object.create(djs.Guild.prototype, { id: { get: () => (reads.id++, AWAY) } }) as djs.Guild
  return { guild, reads }
}
const auditEntry = () => make('GuildAuditLogsEntry', away, { id: '600000000000000001', action_type: 25, target_id: BEN, user_id: ADA, changes: [] }, undefined)

describe('themeTargets, given the arguments discord.js gives an event', () => {
  it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
    // A server, given as itself
    ['guildCreate (Guild)', () => [away], { guildId: AWAY }],
    ['guildUpdate (Guild, Guild)', () => [away, away], { guildId: AWAY }],
    // A server or a channel in one, given after a value that names none
    ['guildMembersChunk (Collection, Guild, data)', () => [new Collection([[BEN, member]]), away, {}], { guildId: AWAY }],
    ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild)', () => [auditEntry(), away], { guildId: AWAY }],
    ['messageDeleteBulk (Collection, channel)', () => [new Collection(), channel], { guildId: AWAY }],
    ['threadMembersUpdate (Collection, Collection, thread)', () => [new Collection(), new Collection(), thread], { guildId: AWAY }],
    // A server reached through the structure's own thread or poll
    ['threadMemberUpdate (ThreadMember, ThreadMember)', () => [threadMember(), threadMember()], { guildId: AWAY, userId: BEN }],
    ['messagePollVoteAdd (PollAnswer, user id)', () => [pollAnswer(), BEN], { guildId: AWAY }],
    // An update whose old value was not cached, read from the new value as if given first
    ['presenceUpdate (null, Presence)', () => [null, presence()], { guildId: AWAY, userId: BEN }],
    ['autoModerationRuleUpdate (null, AutoModerationRule)', () => [null, rule()], { guildId: AWAY }],
    ['entitlementUpdate (null, Entitlement)', () => [null, entitlement()], { guildId: AWAY }],
    ['guildSoundboardSoundUpdate (null, SoundboardSound)', () => [null, sound()], { guildId: AWAY, userId: ADA }],
    ['stageInstanceUpdate (null, StageInstance)', () => [null, stage()], { guildId: AWAY }],
    ['guildScheduledEventUpdate (null, GuildScheduledEvent)', () => [null, scheduled()], { guildId: AWAY }],
    // A bound function given null, a value and a User: the User is the call's second argument, not the value again
    ['a bound function given (null, StageInstance, User)', () => [null, stage(), ben], { guildId: AWAY, userId: BEN }],
  ])('%s: the server it carries', (_event, args, expected) => {
    expect(themeTargets(args())).toEqual(expected)
  })

  it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
    ['roleCreate (Role)', () => [role], { guildId: AWAY }],
    ['guildMemberAdd (GuildMember)', () => [member], { guildId: AWAY, userId: BEN }],
    ['channelCreate (TextChannel)', () => [channel], { guildId: AWAY }],
    ['threadCreate (ThreadChannel, boolean)', () => [thread, true], { guildId: AWAY }],
    ['messageCreate (Message)', () => [message()], { guildId: AWAY, userId: BEN }],
    ['presenceUpdate (Presence, Presence)', () => [presence(), presence()], { guildId: AWAY, userId: BEN }],
    ['userUpdate (User, User)', () => [ben, ben], { userId: BEN }],
    // A direct message's channel has no server, so no later argument is read for one
    ['a bound function given (DMChannel, an away channel)', () => [dmChannel(), channel], {}],
    ['a bound function given (a poll answer in a DM, an away channel)', () => [dmPollAnswer(), channel], {}],
    ['a bound function given (group DM channel, an away channel)', () => [make('PartialGroupDMChannel', client, { id: '300000000000000006', type: ChannelType.GroupDM, name: 'g', icon: null, recipients: [] }), channel], {}],
    // An update whose new value names a user only by id, and no server
    ['subscriptionUpdate (null, Subscription)', () => [null, subscription()], {}],
    // Only a User's own id names a user: the new channel of an update is not one
    ['channelUpdate (channel, channel)', () => [channel, channel], { guildId: AWAY }],
    // Nothing to read: a collector's end, a call with no arguments, a first value that is not an object
    ['a collector\'s end (Collection, reason)', () => [new Collection(), 'time'], {}],
    ['no arguments', () => [], {}],
    ['undefined, then a server', () => [undefined, away], {}],
  ])('%s: read as before', (_event, args, expected) => {
    expect(themeTargets(args())).toEqual(expected)
  })

  it('takes no server after a value whose guildId is null, from its message or a later argument, reading neither', () => {
    const reads = { message: 0 }
    const dm = { guildId: null, get message() { return reads.message++, { guildId: AWAY } } }
    const later = countedGuild()

    expect(themeTargets([dm, later.guild])).toEqual({})
    expect(reads.message).toBe(0)
    expect(later.reads.id).toBe(0)
  })

  it("takes no server after a value whose message's guildId is null, a direct message's, reading no later argument", () => {
    const later = countedGuild()

    expect(themeTargets([{ message: { guildId: null } }, channel])).toEqual({})
    expect(themeTargets([{ message: { guildId: null } }, later.guild])).toEqual({})
    expect(later.reads.id).toBe(0)
  })

  it.each([
    ["a message's server", { message: { guildId: HOME } }],
    ["its own server over its message's null one", { guildId: HOME, message: { guildId: null } }],
    ["its server's over its message's null one", { guild: { id: HOME }, message: { guildId: null } }],
  ])('takes %s over a later channel', (_name, first) => {
    expect(themeTargets([first, channel])).toEqual({ guildId: HOME })
  })

  it.each([
    ['given first', (guild: djs.Guild) => [guild, guild]],
    ['given after a collection', (guild: djs.Guild) => [new Collection(), guild]],
  ])("reads a server's id once, %s", (_name, args) => {
    const { guild, reads } = countedGuild()

    expect(themeTargets(args(guild))).toEqual({ guildId: AWAY })
    expect(reads.id).toBe(1)
  })
})

describe('a mock server as an event argument', () => {
  beforeEach(() => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined))
  afterEach(() => {
    forgetStrictMocks()
    vi.restoreAllMocks()
  })

  it.each([
    ['default', false],
    ['strict', true],
  ])('names its server, with %s mocks, warning of no missing key', (_mode, strict) => {
    forgetStrictMocks()
    if (strict) useStrictMocks()
    const guild = createMockGuild({ id: AWAY })

    expect(themeTargets([guild])).toEqual({ guildId: AWAY })
    expect(themeTargets([new Collection(), guild])).toEqual({ guildId: AWAY })
    expect(Logger.prototype.warn).not.toHaveBeenCalled()
  })
})

const colour = (primary: `#${string}`): ThemeOverride => ({ colors: { primary } })
const resolvers: ThemeResolvers = { guild: ({ guild }) => colour(guild.id === HOME ? '#0000C1' : '#0000C2') }
const primary = () => String(useTheme().colors.primary).toUpperCase()
const pause = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))
const seen: unknown[] = []
let emitter: EventEmitter

@Controller()
@UseTheme({ colors: { info: '#0000D1' } })
class Events {
  @Command('bind', CommandType.BUTTON)
  bind() {
    emitter.on('guild', bindTheme((_guild: djs.Guild) => void seen.push(['bound', primary(), useTheme().colors.info])))
  }

  @On('guildCreate')
  created() {
    seen.push(['guildCreate', primary(), useTheme().colors.info])
  }

  @Once('guildUpdate')
  updated() {
    seen.push(['guildUpdate once', primary(), useTheme().colors.info])
  }

  @On('messageDeleteBulk')
  deleted() {
    seen.push(['messageDeleteBulk', primary(), useTheme().colors.info])
  }

  @On('presenceUpdate')
  presence() {
    seen.push(['presenceUpdate', primary(), useTheme().colors.info])
  }
}

@MeoCord({ controllers: [Events], clientOptions: { intents: [] }, themeFor: resolvers })
class App {}

describe('a call given a server, or an event naming one later', () => {
  beforeEach(() => {
    seen.length = 0
    emitter = new EventEmitter()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it("runs an event's @On and @Once handlers in that server's theme, over the handler's own", async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [Events] }).compile()

    await module.emit('guildCreate', away)
    await module.emit('guildUpdate', away, away)
    await module.emit('messageDeleteBulk', new Collection(), channel)
    await module.emit('presenceUpdate', null, presence())

    expect(seen).toEqual([
      ['guildCreate', '#0000C2', '#0000D1'],
      ['guildUpdate once', '#0000C2', '#0000D1'],
      ['messageDeleteBulk', '#0000C2', '#0000D1'],
      ['presenceUpdate', '#0000C2', '#0000D1'],
    ])
  })

  it('runs a listener bound in one server, given another server, in that server\'s theme', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [Events] }).compile()
    const click = createMockInteraction(ButtonInteraction, { customId: 'bind' })
    Object.assign(click, { guildId: HOME })
    await module.invoke(Events, 'bind', click)
    emitter.emit('guild', away)
    await pause()
    emitter.emit('guild', away)

    expect(seen.at(-1)).toEqual(['bound', '#0000C2', '#0000D1'])
  })

  it("runs a function bound outside any call, given a server, in that server's theme over the app's", async () => {
    const module = await MeoCordTestingModule.create({ app: App, controllers: [Events] }).compile().init({ ready: true })
    // A call on the real client records it as this app's, as a bot's own client is
    const click = createMockInteraction(ButtonInteraction, { customId: 'bind' })
    Object.defineProperty(click, 'client', { value: client })
    await module.invoke(Events, 'bind', click)
    const listener = bindTheme((_guild: djs.Guild) => void seen.push(['outside', primary(), useTheme().colors.info]))
    listener(away)
    await pause()
    listener(away)

    expect(seen.at(-1)).toEqual(['outside', '#0000C2', DEFAULT_THEME.colors.info])
    await module.close()
  })
})
