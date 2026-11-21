import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as djs from 'discord.js'
import { ButtonInteraction, ChannelType, Client, Collection, Events as ClientEvent } from 'discord.js'
import { Command, Controller, MeoCord, On, Once, UseTheme } from '@src/decorator/index.js'
import { bindTheme, Logger, useTheme } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { themeTargets } from '@src/core/theme-resolvers.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockClient, createMockGuild, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// The server and user a call is themed for, from the arguments discord.js gives each event

const HOME = '100000000000000001'
const AWAY = '100000000000000002'
const ADA = '200000000000000001'
const BEN = '200000000000000002'
/** A user the client has not cached, so a structure's `user` is null and only its id names them. */
const CARA = '200000000000000003'
const BOT = '200000000000000009'
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
const voiceState = () => make('VoiceState', away, { user_id: CARA, channel_id: CHANNEL, session_id: 's', deaf: false, mute: false, self_deaf: false, self_mute: false, self_video: false, suppress: false, request_to_speak_timestamp: null })
const voiceEffect = () => make('VoiceChannelEffect', { channel_id: CHANNEL, guild_id: AWAY, user_id: CARA, emoji: null, animation_type: null, animation_id: null }, away)
const autoModAction = () => make('AutoModerationActionExecution', { guild_id: AWAY, action: { type: 1, metadata: {} }, rule_id: '700000000000000005', rule_trigger_type: 1, user_id: CARA, content: '' }, away)
const caraPresence = () => add<djs.Presence>(away.presences, { user: { id: CARA }, guild_id: AWAY, guild: away, status: 'online', activities: [], client_status: {} })
const caraThreadMember = () => make('ThreadMember', thread, { id: THREAD, user_id: CARA, join_timestamp: new Date().toISOString(), flags: 0 })
const auditEntry = (userId: string | null = ADA, guild = away) =>
  make('GuildAuditLogsEntry', guild, { id: '600000000000000001', action_type: 25, target_id: BEN, user_id: userId, changes: [] }, undefined)
const invite = (inviter?: string) => make('Invite', client, { code: 'abc', guild: away, channel, ...(inviter && { inviter: userData(inviter) }) })
const sticker = () =>
  make('Sticker', client, { id: '700000000000000009', name: 's', tags: 't', type: 2, format_type: 1, guild_id: AWAY, available: true, user: userData(ADA) })
const emoji = () => make('GuildEmoji', client, { id: '700000000000000010', name: 'e', user: userData(ADA), roles: [], animated: false, available: true, managed: false, require_colons: true }, away)
const ownedThread = () =>
  add<djs.ThreadChannel>(
    client.channels,
    { id: '300000000000000010', type: ChannelType.PublicThread, guild_id: AWAY, parent_id: CHANNEL, owner_id: ADA, name: 't', thread_metadata: { archived: false, auto_archive_duration: 60, archive_timestamp: new Date().toISOString(), locked: false } },
    away,
  )
/** A client logged in as the bot, which it caches as discord.js does, with a server of its own. */
const botClient = new Client({ intents: [] })
const botUser = make<djs.ClientUser>('ClientUser', botClient, userData(BOT))
botClient.user = botUser
botClient.users.cache.set(BOT, botUser)
const botGuild = add<djs.Guild>(botClient.guilds, guildData(HOME))

describe('themeTargets, given the arguments discord.js gives an event', () => {
  it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
    // A server, given as itself
    ['guildCreate (Guild)', () => [away], { guildId: AWAY }],
    ['guildUpdate (Guild, Guild)', () => [away, away], { guildId: AWAY }],
    // A server or a channel in one, given after a value that names none
    ['guildMembersChunk (Collection, Guild, data)', () => [new Collection([[BEN, member]]), away, {}], { guildId: AWAY }],
    ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild)', () => [auditEntry(), away], { guildId: AWAY, userId: ADA }],
    ['messageDeleteBulk (Collection, channel)', () => [new Collection(), channel], { guildId: AWAY }],
    ['threadMembersUpdate (Collection, Collection, thread)', () => [new Collection(), new Collection(), thread], { guildId: AWAY }],
    // A server reached through the structure's own thread or poll
    ['threadMemberUpdate (ThreadMember, ThreadMember)', () => [threadMember(), threadMember()], { guildId: AWAY, userId: BEN }],
    // An update whose old value was not cached, read from the new value as if given first
    ['presenceUpdate (null, Presence)', () => [null, presence()], { guildId: AWAY, userId: BEN }],
    ['autoModerationRuleUpdate (null, AutoModerationRule)', () => [null, rule()], { guildId: AWAY }],
    ['entitlementUpdate (null, Entitlement)', () => [null, entitlement()], { guildId: AWAY, userId: BEN }],
    // Its user is the sound's creator, the call's user only in the event that created it
    ['guildSoundboardSoundUpdate (null, SoundboardSound)', () => [null, sound()], { guildId: AWAY }],
    ['stageInstanceUpdate (null, StageInstance)', () => [null, stage()], { guildId: AWAY }],
    ['guildScheduledEventUpdate (null, GuildScheduledEvent)', () => [null, scheduled()], { guildId: AWAY }],
    // A bound function given null, a value and a User: the User is the call's second argument, not the value again
    ['a bound function given (null, StageInstance, User)', () => [null, stage(), ben], { guildId: AWAY, userId: BEN }],
  ])('%s: the server it carries', (_event, args, expected) => {
    expect(themeTargets(args())).toEqual(expected)
  })

  // The user a structure of its class names by id, whose `user` discord.js leaves null until it caches them
  it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
    ['messagePollVoteAdd (PollAnswer, user id)', () => [pollAnswer(), CARA], { guildId: AWAY, userId: CARA }],
    ['messagePollVoteRemove (a poll answer in a DM, user id)', () => [dmPollAnswer(), CARA], { userId: CARA }],
    ['voiceStateUpdate (VoiceState, VoiceState)', () => [voiceState(), voiceState()], { guildId: AWAY, userId: CARA }],
    ['voiceChannelEffectSend (VoiceChannelEffect)', () => [voiceEffect()], { guildId: AWAY, userId: CARA }],
    ['presenceUpdate (null, Presence)', () => [null, caraPresence()], { guildId: AWAY, userId: CARA }],
    ['threadMemberUpdate (ThreadMember, ThreadMember)', () => [caraThreadMember(), caraThreadMember()], { guildId: AWAY, userId: CARA }],
    ['autoModerationActionExecution (AutoModerationActionExecution)', () => [autoModAction()], { guildId: AWAY, userId: CARA }],
    ['entitlementCreate (Entitlement)', () => [entitlement()], { guildId: AWAY, userId: BEN }],
    ['subscriptionCreate (Subscription)', () => [subscription()], { userId: BEN }],
    ['subscriptionUpdate (null, Subscription)', () => [null, subscription()], { userId: BEN }],
    ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild), by an uncached user', () => [auditEntry(CARA), away], { guildId: AWAY, userId: CARA }],
    // Its own id over a string given second
    ['a bound function given (VoiceState, another user id)', () => [voiceState(), BEN], { guildId: AWAY, userId: CARA }],
  ])('%s: the user it names by id', (_event, args, expected) => {
    expect(themeTargets(args())).toEqual(expected)
  })

  // No user: the bot, an action with no executor or the bot's own, an invite discord.js gives no inviter
  it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
    ['clientReady (Client)', () => [botClient], {}],
    ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild), by the bot', () => [auditEntry(BOT, botGuild), botGuild], { guildId: HOME }],
    ['a bound function given (GuildAuditLogsEntry by the bot)', () => [auditEntry(BOT, botGuild)], {}],
    ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild), by no one', () => [auditEntry(null), away], { guildId: AWAY }],
  ])('%s: no user', (_event, args, expected) => {
    expect(themeTargets(args())).toEqual(expected)
  })

  // A creator is the call's user only in the event that created the structure, never in its later updates and deletes
  it.each<[string, string, string[], () => unknown, unknown[]]>([
    ['Sticker', ClientEvent.GuildStickerCreate, [ClientEvent.GuildStickerUpdate, ClientEvent.GuildStickerDelete], sticker, []],
    ['GuildEmoji', ClientEvent.GuildEmojiCreate, [ClientEvent.GuildEmojiUpdate, ClientEvent.GuildEmojiDelete], emoji, []],
    ['SoundboardSound', ClientEvent.GuildSoundboardSoundCreate, [ClientEvent.GuildSoundboardSoundUpdate, ClientEvent.GuildSoundboardSoundDelete], sound, []],
    ['ThreadChannel', ClientEvent.ThreadCreate, [ClientEvent.ThreadUpdate, ClientEvent.ThreadDelete], ownedThread, [true]],
    ['AutoModerationRule', ClientEvent.AutoModerationRuleCreate, [ClientEvent.AutoModerationRuleUpdate, ClientEvent.AutoModerationRuleDelete], rule, []],
    ['GuildScheduledEvent', ClientEvent.GuildScheduledEventCreate, [ClientEvent.GuildScheduledEventUpdate, ClientEvent.GuildScheduledEventDelete], scheduled, []],
    ['Invite', ClientEvent.InviteCreate, [ClientEvent.InviteDelete], () => invite(ADA), []],
  ])('%s: its creator is the user in %s only', (_class, created, others, made, createdWith) => {
    const value = made()

    expect(themeTargets([value, ...createdWith], created)).toEqual({ guildId: AWAY, userId: ADA })
    for (const event of others) expect(themeTargets([value, value], event)).toEqual({ guildId: AWAY })
    // A function bindTheme wraps is given no event
    expect(themeTargets([value])).toEqual({ guildId: AWAY })
  })

  it('reads no owner of a thread the bot only gained access to, which threadCreate gives as not newly created', () => {
    expect(themeTargets([ownedThread(), false], ClientEvent.ThreadCreate)).toEqual({ guildId: AWAY })
  })

  it('reads no deleted invite\'s inviter, which discord.js gives none', () => {
    expect(themeTargets([invite()], ClientEvent.InviteCreate)).toEqual({ guildId: AWAY })
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
    // Only a User's own id names a user: the new channel of an update is not one
    ['channelUpdate (channel, channel)', () => [channel, channel], { guildId: AWAY }],
    // Nothing to read: a collector's end, a call with no arguments, a first value that is not an object
    ['a collector\'s end (Collection, reason)', () => [new Collection(), 'time'], {}],
    // A string second names a user only after a poll answer: here it is a reason, or another value's id
    ['a bound function given (StageInstance, a string)', () => [stage(), BEN], { guildId: AWAY }],
    ['a bound function given (Role, a string)', () => [role, BEN], { guildId: AWAY }],
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

  const mock = <T extends object>(Class: { prototype: T }, props: object) => createMockInteraction(Class as never, props as never) as T
  describe.each([
    ['default', false],
    ['strict', true],
  ])('a mock structure naming a user by id or none, with %s mocks', (_mode, strict) => {
    beforeEach(() => {
      forgetStrictMocks()
      if (strict) useStrictMocks()
    })

    it.each<[string, () => unknown[], { guildId?: string; userId?: string }]>([
      ['messagePollVoteAdd (PollAnswer, user id)', () => [mock(djs.PollAnswer, { poll: { message: { guildId: AWAY } } }), CARA], { guildId: AWAY, userId: CARA }],
      ['voiceStateUpdate (VoiceState, VoiceState)', () => [mock(djs.VoiceState, { id: CARA, guild: { id: AWAY } }), mock(djs.VoiceState, { id: CARA, guild: { id: AWAY } })], { guildId: AWAY, userId: CARA }],
      ['voiceChannelEffectSend (VoiceChannelEffect)', () => [mock(djs.VoiceChannelEffect, { userId: CARA, guild: { id: AWAY } })], { guildId: AWAY, userId: CARA }],
      ['presenceUpdate (null, Presence)', () => [null, mock(djs.Presence, { userId: CARA, guild: { id: AWAY }, user: null })], { guildId: AWAY, userId: CARA }],
      ['threadMemberUpdate (ThreadMember, ThreadMember)', () => [mock(djs.ThreadMember, { id: CARA, thread: { guildId: AWAY }, user: null }), mock(djs.ThreadMember, { id: CARA, thread: { guildId: AWAY }, user: null })], { guildId: AWAY, userId: CARA }],
      ['autoModerationActionExecution (AutoModerationActionExecution)', () => [mock(djs.AutoModerationActionExecution, { userId: CARA, guild: { id: AWAY }, user: null })], { guildId: AWAY, userId: CARA }],
      ['entitlementCreate (Entitlement)', () => [mock(djs.Entitlement, { userId: CARA, guildId: AWAY })], { guildId: AWAY, userId: CARA }],
      ['subscriptionCreate (Subscription)', () => [mock(djs.Subscription, { userId: CARA })], { userId: CARA }],
      ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild)', () => [mock(djs.GuildAuditLogsEntry, { executorId: CARA, executor: null }), createMockGuild({ id: AWAY })], { guildId: AWAY, userId: CARA }],
      // No user
      ['clientReady (Client)', () => [createMockClient()], {}],
      ["guildAuditLogEntryCreate (GuildAuditLogsEntry, the bot's Guild), by the bot", () => [mock(djs.GuildAuditLogsEntry, { executorId: BOT, executor: null }), botGuild], { guildId: HOME }],
      ['guildAuditLogEntryCreate (GuildAuditLogsEntry, Guild), by no one', () => [mock(djs.GuildAuditLogsEntry, { executorId: null, executor: null }), createMockGuild({ id: AWAY })], { guildId: AWAY }],
      // A string second after another structure is no user
      ['a bound function given (mock StageInstance, a string)', () => [mock(djs.StageInstance, { guildId: AWAY }), CARA], { guildId: AWAY }],
    ])('%s: its user, warning of no missing key', (_event, args, expected) => {
      expect(themeTargets(args())).toEqual(expected)
      expect(Logger.prototype.warn).not.toHaveBeenCalled()
    })

    it.each<[string, string, string, () => object, unknown[]]>([
      ['Sticker', ClientEvent.GuildStickerCreate, ClientEvent.GuildStickerUpdate, () => mock(djs.Sticker, { user: { id: CARA }, guildId: AWAY }), []],
      ['GuildEmoji', ClientEvent.GuildEmojiCreate, ClientEvent.GuildEmojiDelete, () => mock(djs.GuildEmoji, { author: { id: CARA }, guild: { id: AWAY } }), []],
      ['SoundboardSound', ClientEvent.GuildSoundboardSoundCreate, ClientEvent.GuildSoundboardSoundUpdate, () => mock(djs.SoundboardSound, { user: { id: CARA }, guildId: AWAY }), []],
      ['ThreadChannel', ClientEvent.ThreadCreate, ClientEvent.ThreadDelete, () => mock(djs.ThreadChannel, { ownerId: CARA, guildId: AWAY }), [true]],
      ['AutoModerationRule', ClientEvent.AutoModerationRuleCreate, ClientEvent.AutoModerationRuleUpdate, () => mock(djs.AutoModerationRule, { creatorId: CARA, guild: { id: AWAY } }), []],
      ['GuildScheduledEvent', ClientEvent.GuildScheduledEventCreate, ClientEvent.GuildScheduledEventDelete, () => mock(djs.GuildScheduledEvent, { creatorId: CARA, guildId: AWAY }), []],
      ['Invite', ClientEvent.InviteCreate, ClientEvent.InviteDelete, () => mock(djs.Invite, { inviterId: CARA, guild: { id: AWAY } }), []],
    ])('a mock %s: its creator is the user in %s, not in %s, nor with no event', (_class, created, other, made, createdWith) => {
      const value = made()

      expect(themeTargets([value, ...createdWith], created)).toEqual({ guildId: AWAY, userId: CARA })
      expect(themeTargets([value], other)).toEqual({ guildId: AWAY })
      expect(themeTargets([value])).toEqual({ guildId: AWAY })
      expect(Logger.prototype.warn).not.toHaveBeenCalled()
    })

    it('a mock ThreadChannel: no owner in threadCreate when not newly created', () => {
      expect(themeTargets([mock(djs.ThreadChannel, { ownerId: CARA, guildId: AWAY }), false], ClientEvent.ThreadCreate)).toEqual({ guildId: AWAY })
      expect(Logger.prototype.warn).not.toHaveBeenCalled()
    })
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

@Controller()
class Votes {
  @On('messagePollVoteAdd')
  voted() {
    seen.push(['messagePollVoteAdd', primary()])
  }

  @On('stickerCreate')
  stickerCreated() {
    seen.push(['stickerCreate', primary()])
  }

  @On('stickerUpdate')
  stickerUpdated() {
    seen.push(['stickerUpdate', primary()])
  }

  @Command('bind-sticker', CommandType.BUTTON)
  bindSticker() {
    emitter.on('sticker', bindTheme((_sticker: djs.Sticker) => void seen.push(['bound', primary()])))
  }
}

@MeoCord({ controllers: [Votes], clientOptions: { intents: [] }, themeFor: { user: ({ user }) => colour(user.id === CARA ? '#0000E1' : user.id === ADA ? '#0000E3' : '#0000E2') } })
class VoteApp {}

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

  it("runs a poll vote's handler in the voter's theme", async () => {
    const module = MeoCordTestingModule.create({ app: VoteApp, controllers: [Votes] }).compile()

    await module.emit('messagePollVoteAdd', pollAnswer() as djs.PollAnswer, CARA)

    expect(seen).toEqual([['messagePollVoteAdd', '#0000E1']])
  })

  it("runs a sticker's create handler in its creator's theme, and its update handler in none", async () => {
    const module = MeoCordTestingModule.create({ app: VoteApp, controllers: [Votes] }).compile()
    const made = sticker() as djs.Sticker

    await module.emit('stickerCreate', made)
    await module.emit('stickerUpdate', made, made)

    expect(seen).toEqual([
      ['stickerCreate', '#0000E3'],
      ['stickerUpdate', String(DEFAULT_THEME.colors.primary).toUpperCase()],
    ])
  })

  it("runs a sticker's create handler that invoke runs in its creator's theme, and its update handler in none", async () => {
    const module = MeoCordTestingModule.create({ app: VoteApp, controllers: [Votes] }).compile()
    const made = sticker() as djs.Sticker

    await module.invoke(Votes, 'stickerCreated', made)
    await module.invoke(Votes, 'stickerUpdated', made, made)

    expect(seen).toEqual([
      ['stickerCreate', '#0000E3'],
      ['stickerUpdate', String(DEFAULT_THEME.colors.primary).toUpperCase()],
    ])
  })

  it("runs a sticker's create handler that strict invoke runs in its creator's theme, and its update handler in none", async () => {
    const module = MeoCordTestingModule.create({ app: VoteApp, controllers: [Votes] }).compile()
    const made = sticker() as djs.Sticker
    useStrictMocks()
    try {
      await module.invoke(Votes, 'stickerCreated', made)
      await module.invoke(Votes, 'stickerUpdated', made, made)
    } finally {
      forgetStrictMocks()
    }

    expect(seen).toEqual([
      ['stickerCreate', '#0000E3'],
      ['stickerUpdate', String(DEFAULT_THEME.colors.primary).toUpperCase()],
    ])
  })

  it("runs a bound function given a sticker in no creator's theme", async () => {
    const module = MeoCordTestingModule.create({ app: VoteApp, controllers: [Votes] }).compile()
    const click = createMockInteraction(ButtonInteraction, { customId: 'bind-sticker' })
    Object.assign(click, { user: { id: CARA } })
    await module.invoke(Votes, 'bindSticker', click)
    emitter.emit('sticker', sticker())
    await pause()
    emitter.emit('sticker', sticker())

    expect(seen.at(-1)).toEqual(['bound', String(DEFAULT_THEME.colors.primary).toUpperCase()])
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
