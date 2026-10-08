import 'reflect-metadata'
import { vi } from 'vitest'
import { createMockFn } from './mock-fn.js'
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  ApplicationIntegrationType,
  Attachment,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  AuthorizingIntegrationOwners,
  BaseInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ContextMenuCommandInteraction,
  Guild,
  Message,
  MessageComponentInteraction,
  MessageFlags,
  MessageReaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  AutocompleteInteraction,
  DMChannel,
  ForumChannel,
  MediaChannel,
  NewsChannel,
  TextChannel,
  ThreadChannel,
  User,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  MentionableSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
  PrimaryEntryPointCommandInteraction,
  ChannelType,
  Collection,
  DiscordjsErrorCodes,
  GuildMember,
  Locale,
  Role,
  SnowflakeUtil,
} from 'discord.js'
import {
  createMockInteraction,
  createChatInputOptions,
  createMock,
  createMockUser,
  createMockClient,
  createMockGuild,
  createMockChannel,
  createMockMessage,
  createMockMember,
} from './mock-interaction.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createTranslator } from '@src/common/translator.js'
import { Guard, UseGuard } from '@src/decorator/guard.decorator.js'
import { type GuardInterface } from '@src/interface/index.js'

describe('createMockInteraction', () => {
  describe('instanceof checks', () => {
    it('passes instanceof for the given class', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction).toBeInstanceOf(ButtonInteraction)
    })

    it('passes instanceof for all ancestor classes', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction).toBeInstanceOf(MessageComponentInteraction)
      expect(interaction).toBeInstanceOf(BaseInteraction)
    })

    it('works for ChatInputCommandInteraction', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction).toBeInstanceOf(ChatInputCommandInteraction)
      expect(interaction).toBeInstanceOf(BaseInteraction)
    })

    it('works for ModalSubmitInteraction', () => {
      const interaction = createMockInteraction(ModalSubmitInteraction)
      expect(interaction).toBeInstanceOf(ModalSubmitInteraction)
      expect(interaction).toBeInstanceOf(BaseInteraction)
    })

    it('works for StringSelectMenuInteraction', () => {
      const interaction = createMockInteraction(StringSelectMenuInteraction)
      expect(interaction).toBeInstanceOf(StringSelectMenuInteraction)
      expect(interaction).toBeInstanceOf(BaseInteraction)
    })

    it('works for Message', () => {
      const msg = createMockInteraction(Message)
      expect(msg).toBeInstanceOf(Message)
    })

    it('works for MessageReaction', () => {
      const reaction = createMockInteraction(MessageReaction)
      expect(reaction).toBeInstanceOf(MessageReaction)
    })
  })

  describe('auto-stubbing', () => {
    it('auto-stubs prototype methods as mock functions', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(typeof interaction.isButton).toBe('function')
      expect(vi.isMockFunction(interaction.isButton)).toBe(true)
    })

    it('returns the same stub reference on repeated access', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction.isButton).toBe(interaction.isButton)
    })

    it('stub is callable and configurable', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      interaction.isButton.mockReturnValue(true)
      expect(interaction.isButton()).toBe(true)
    })

    it('auto-stubs nested method access', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(vi.isMockFunction(interaction.reply)).toBe(true)
      interaction.reply.mockResolvedValue(undefined)
      await expect(interaction.reply({ content: 'hi' })).resolves.toBeUndefined()
    })

    it('does not stub symbols', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(vi.isMockFunction((interaction as any)[Symbol.iterator])).toBe(false)
    })

    it('does not make the mock thenable (avoids Promise confusion)', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect((interaction as any).then).toBeUndefined()
    })
  })

  describe('auto-configured type guards', () => {
    it('ChatInputCommandInteraction auto-returns true for isChatInputCommand()', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction.isChatInputCommand()).toBe(true)
    })

    it('ChatInputCommandInteraction auto-returns true for isCommand()', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction.isCommand()).toBe(true)
    })

    it('ButtonInteraction auto-returns true for isButton()', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction.isButton()).toBe(true)
    })

    it('ButtonInteraction auto-returns true for isMessageComponent()', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction.isMessageComponent()).toBe(true)
    })

    it('StringSelectMenuInteraction auto-returns true for isStringSelectMenu()', () => {
      const interaction = createMockInteraction(StringSelectMenuInteraction)
      expect(interaction.isStringSelectMenu()).toBe(true)
    })

    it('StringSelectMenuInteraction auto-returns true for isMessageComponent()', () => {
      const interaction = createMockInteraction(StringSelectMenuInteraction)
      expect(interaction.isMessageComponent()).toBe(true)
    })

    it('ModalSubmitInteraction auto-returns true for isModalSubmit()', () => {
      const interaction = createMockInteraction(ModalSubmitInteraction)
      expect(interaction.isModalSubmit()).toBe(true)
    })

    it('ContextMenuCommandInteraction auto-returns true for isContextMenuCommand()', () => {
      const interaction = createMockInteraction(ContextMenuCommandInteraction)
      expect(interaction.isContextMenuCommand()).toBe(true)
    })

    it('AutocompleteInteraction auto-returns true for isAutocomplete()', () => {
      const interaction = createMockInteraction(AutocompleteInteraction)
      expect(interaction.isAutocomplete()).toBe(true)
    })

    it('UserSelectMenuInteraction auto-returns true for isUserSelectMenu()', () => {
      const interaction = createMockInteraction(UserSelectMenuInteraction)
      expect(interaction.isUserSelectMenu()).toBe(true)
    })

    it('UserSelectMenuInteraction auto-returns true for isMessageComponent()', () => {
      const interaction = createMockInteraction(UserSelectMenuInteraction)
      expect(interaction.isMessageComponent()).toBe(true)
    })

    it('RoleSelectMenuInteraction auto-returns true for isRoleSelectMenu()', () => {
      const interaction = createMockInteraction(RoleSelectMenuInteraction)
      expect(interaction.isRoleSelectMenu()).toBe(true)
    })

    it('MentionableSelectMenuInteraction auto-returns true for isMentionableSelectMenu()', () => {
      const interaction = createMockInteraction(MentionableSelectMenuInteraction)
      expect(interaction.isMentionableSelectMenu()).toBe(true)
    })

    it('ChannelSelectMenuInteraction auto-returns true for isChannelSelectMenu()', () => {
      const interaction = createMockInteraction(ChannelSelectMenuInteraction)
      expect(interaction.isChannelSelectMenu()).toBe(true)
    })

    it('UserContextMenuCommandInteraction auto-returns true for isUserContextMenuCommand()', () => {
      const interaction = createMockInteraction(UserContextMenuCommandInteraction)
      expect(interaction.isUserContextMenuCommand()).toBe(true)
    })

    it('MessageContextMenuCommandInteraction auto-returns true for isMessageContextMenuCommand()', () => {
      const interaction = createMockInteraction(MessageContextMenuCommandInteraction)
      expect(interaction.isMessageContextMenuCommand()).toBe(true)
    })

    it('PrimaryEntryPointCommandInteraction auto-returns true for isPrimaryEntryPointCommand()', () => {
      const interaction = createMockInteraction(PrimaryEntryPointCommandInteraction)
      expect(interaction.isPrimaryEntryPointCommand()).toBe(true)
    })

    // `isSelectMenu` is deprecated in discord.js, so the mock deliberately leaves it
    // unwired rather than reproducing behaviour the library is removing.
    it('does not wire the deprecated isSelectMenu() guard', () => {
      const interaction = createMockInteraction(StringSelectMenuInteraction)
      expect(interaction.isStringSelectMenu()).toBe(true)
      expect(interaction.isSelectMenu()).toBeUndefined()
    })

    it('user can still override type guard return value', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      interaction.isButton.mockReturnValue(false)
      expect(interaction.isButton()).toBe(false)
    })

    it('BaseInteraction type guards return false (no type fields set)', () => {
      const interaction = createMockInteraction(BaseInteraction)
      expect(interaction.isChatInputCommand()).toBe(false)
      expect(interaction.isButton()).toBe(false)
    })
  })

  describe('isRepliable', () => {
    it('returns true for ChatInputCommandInteraction', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction.isRepliable()).toBe(true)
    })

    it('returns true for ButtonInteraction', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction.isRepliable()).toBe(true)
    })

    it('returns true for ModalSubmitInteraction', () => {
      const interaction = createMockInteraction(ModalSubmitInteraction)
      expect(interaction.isRepliable()).toBe(true)
    })

    it('returns false for AutocompleteInteraction', () => {
      const interaction = createMockInteraction(AutocompleteInteraction)
      expect(interaction.isRepliable()).toBe(false)
    })

    it('is a mock function — can be overridden per test', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      interaction.isRepliable.mockReturnValue(false)
      expect(interaction.isRepliable()).toBe(false)
    })
  })

  describe('showModal', () => {
    it('is a first response: it answers the interaction, and cannot follow a reply', async () => {
      const shown = createMockInteraction(ChatInputCommandInteraction)
      await shown.showModal({ customId: 'm', title: 'T', components: [] })
      expect(shown.replied).toBe(true)

      const replied = createMockInteraction(ButtonInteraction)
      await replied.reply('first')
      await expect(replied.showModal({ customId: 'm', title: 'T', components: [] })).rejects.toThrow()
    })

    it("leaves a command no reply to edit, fetch or delete, as Discord answers an original response that doesn't exist", async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.showModal({ customId: 'm', title: 'T', components: [] })

      await expect(interaction.editReply('x')).rejects.toMatchObject({ code: 10008 })
      await expect(interaction.fetchReply()).rejects.toMatchObject({ code: 10008 })
      await expect(interaction.deleteReply()).rejects.toMatchObject({ code: 10008 })
    })
  })

  describe('deferUpdate on a modal submission', () => {
    it('defers like a component does', async () => {
      const modal = createMockInteraction(ModalSubmitInteraction, { message: createMockMessage() as never })
      await modal.deferUpdate()
      expect(modal.deferred).toBe(true)
    })
  })

  describe('authorizingIntegrationOwners', () => {
    it('builds the discord.js object from the plain map Discord sends', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, {
        authorizingIntegrationOwners: { [ApplicationIntegrationType.UserInstall]: 'user-1' },
      })

      expect(interaction.authorizingIntegrationOwners).toBeInstanceOf(AuthorizingIntegrationOwners)
      expect(interaction.authorizingIntegrationOwners.userId).toBe('user-1')
      expect(interaction.authorizingIntegrationOwners.guildId).toBeNull()
      expect(interaction.authorizingIntegrationOwners[ApplicationIntegrationType.UserInstall]).toBe('user-1')
    })
  })

  describe('isFromMessage', () => {
    it('tells a modal submitted from a message from one submitted from a command', () => {
      const fromCommand = createMockInteraction(ModalSubmitInteraction)
      const fromMessage = createMockInteraction(ModalSubmitInteraction, { message: createMockMessage() as never })

      expect(fromCommand.isFromMessage()).toBe(false)
      expect(fromMessage.isFromMessage()).toBe(true)
    })
  })

  describe('reply state machine', () => {
    it('replied and deferred start as false booleans', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect(interaction.replied).toBe(false)
      expect(interaction.deferred).toBe(false)
      expect(typeof interaction.replied).toBe('boolean')
      expect(typeof interaction.deferred).toBe('boolean')
    })

    it('reply() sets replied to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'hi' })
      expect(interaction.replied).toBe(true)
    })

    it('deferReply() sets deferred to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferReply()
      expect(interaction.deferred).toBe(true)
    })

    it('reply() twice throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'first' })
      await expect(interaction.reply({ content: 'second' })).rejects.toThrow()
    })

    it('deferReply() then reply() throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferReply()
      await expect(interaction.reply({ content: 'hi' })).rejects.toThrow()
    })

    it('reply() then deferReply() throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'hi' })
      await expect(interaction.deferReply()).rejects.toThrow()
    })

    it('followUp() before any reply throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await expect(interaction.followUp({ content: 'hi' })).rejects.toThrow()
    })

    it('followUp() after reply() resolves', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'first' })
      await expect(interaction.followUp({ content: 'second' })).resolves.not.toThrow()
    })

    it('followUp() after deferReply() resolves', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferReply()
      await expect(interaction.followUp({ content: 'hi' })).resolves.not.toThrow()
    })

    it('editReply() before any reply throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await expect(interaction.editReply({ content: 'hi' })).rejects.toThrow()
    })

    it('deleteReply() before any reply throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await expect(interaction.deleteReply()).rejects.toThrow()
    })

    it('reply is a mock function — call assertions still work', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.reply({ content: 'hello' })
      expect(interaction.reply).toHaveBeenCalledWith({ content: 'hello' })
    })

    it('followUp() resolves to a Message instance', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.reply({ content: 'first' })
      const msg = await interaction.followUp({ content: 'second' })
      expect(msg).toBeInstanceOf(Message)
    })

    it('editReply() resolves to a Message instance', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()
      const msg = await interaction.editReply({ content: 'done' })
      expect(msg).toBeInstanceOf(Message)
    })

    it('state machine is not set up for AutocompleteInteraction (not repliable)', () => {
      const interaction = createMockInteraction(AutocompleteInteraction)
      expect(typeof (interaction as any).replied).not.toBe('boolean')
      expect(typeof (interaction as any).deferred).not.toBe('boolean')
    })

    it('ephemeral starts as false', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      expect((interaction as any).ephemeral).toBe(false)
    })

    it('reply() with ephemeral flag sets ephemeral to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ flags: MessageFlags.Ephemeral })
      expect((interaction as any).ephemeral).toBe(true)
    })

    it('reply() without ephemeral flag leaves ephemeral false', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'hi' })
      expect((interaction as any).ephemeral).toBe(false)
    })

    it('deferReply() with ephemeral flag sets ephemeral to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      expect((interaction as any).ephemeral).toBe(true)
    })

    it('editReply() after deferReply() sets replied to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferReply()
      expect(interaction.replied).toBe(false)
      await interaction.editReply({ content: 'done' })
      expect(interaction.replied).toBe(true)
    })

    it('followUp() after reply() sets replied to true (already true, stays true)', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.reply({ content: 'first' })
      await interaction.followUp({ content: 'second' })
      expect(interaction.replied).toBe(true)
    })
  })

  describe('deferUpdate / update (MessageComponentInteraction)', () => {
    it('update() sets replied to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await (interaction as any).update({ content: 'updated' })
      expect(interaction.replied).toBe(true)
    })

    it('deferUpdate() sets deferred to true', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await (interaction as any).deferUpdate()
      expect(interaction.deferred).toBe(true)
    })

    it('update() twice throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await (interaction as any).update({ content: 'first' })
      await expect((interaction as any).update({ content: 'second' })).rejects.toThrow()
    })

    it('deferUpdate() then reply() throws', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await (interaction as any).deferUpdate()
      await expect(interaction.reply({ content: 'hi' })).rejects.toThrow()
    })

    it('update() is not set up for ChatInputCommandInteraction', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(vi.isMockFunction((interaction as any).update)).toBe(false)
    })
  })

  describe('direct property writes', () => {
    it('allows writing primitive properties', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      ;(interaction as any).guildId = 'guild-123'
      expect((interaction as any).guildId).toBe('guild-123')
    })

    it('own property takes precedence over auto-stub', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      const customOptions = { getSubcommand: vi.fn().mockReturnValue('ping') }
      ;(interaction as any).options = customOptions
      expect((interaction as any).options.getSubcommand()).toBe('ping')
    })

    // discord.js declares targetUser / targetMessage as prototype getters with no setter, and a plain write to one
    // throws in strict code, so the mock's write shadows the accessor with an own data property.
    it('a write to a prototype getter shadows it with an own value', () => {
      const interaction = createMockInteraction(UserContextMenuCommandInteraction)
      const target = createMockUser()
      ;(interaction as any).targetUser = target
      expect((interaction as any).targetUser).toBe(target)
    })

    it('a write to another prototype getter shadows it too (targetMessage)', () => {
      const interaction = createMockInteraction(MessageContextMenuCommandInteraction)
      const message = createMockMessage()
      ;(interaction as any).targetMessage = message
      expect((interaction as any).targetMessage).toBe(message)
    })
  })

  // Properties that discord.js declares `readonly` cannot be assigned once the
  // returned type is assignable to the real class. Passing them at construction
  // keeps setup type-safe without reaching for a cast.
  describe('initial props', () => {
    it('applies a plain property', () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'gi-profile-1-2' })
      expect(interaction.customId).toBe('gi-profile-1-2')
    })

    it('applies a property discord.js declares readonly', () => {
      const interaction = createMockInteraction(ModalSubmitInteraction, { customId: 'gi-wish-import-1' })
      expect(interaction.customId).toBe('gi-wish-import-1')
    })

    it('applies a property backed by a prototype getter', () => {
      const target = createMockUser()
      const interaction = createMockInteraction(UserContextMenuCommandInteraction, { targetUser: target })
      expect(interaction.targetUser).toBe(target)
    })

    it('leaves the auto-stub in place for properties not passed', () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'x' })
      expect(interaction.reply).toBeTypeOf('function')
    })

    it('gives the time the mock was made with its generated id, the time an id the test gives encodes, and a set time', () => {
      const before = Date.now()
      const made = createMockInteraction(ButtonInteraction, { customId: 'x' })
      const after = Date.now()
      const given = createMockInteraction(ButtonInteraction, { customId: 'x', id: '1200000000000000000' })
      const set = createMockInteraction(ButtonInteraction, { customId: 'x', createdTimestamp: 42 })

      expect(made.createdTimestamp).toBeGreaterThanOrEqual(before)
      expect(made.createdTimestamp).toBeLessThanOrEqual(after)
      expect(made.createdAt).toEqual(new Date(made.createdTimestamp))
      expect(given.createdTimestamp).toBe(SnowflakeUtil.timestampFrom('1200000000000000000'))
      expect(set.createdTimestamp).toBe(42)
    })

    it('reads the time from an id the test sets later, and gives the time it was made without an id', () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'x' })
      interaction.id = '1200000000000000000'
      const before = Date.now()
      const withoutId = createMockInteraction(ButtonInteraction, { customId: 'x', id: undefined })

      expect(interaction.createdTimestamp).toBe(SnowflakeUtil.timestampFrom('1200000000000000000'))
      expect(withoutId.createdTimestamp).toBeGreaterThanOrEqual(before)
    })

    it('keeps generating ids that count up by one, so a test can rely on them', () => {
      const first = createMockUser()
      const second = createMockUser()

      expect(first.id).toMatch(/^14000000000000\d{5}$/)
      expect(BigInt(second.id)).toBe(BigInt(first.id) + 1n)
    })

    it('does not disturb the type guards', () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'x' })
      expect(interaction.isButton()).toBe(true)
    })
  })

  describe('guild checks', () => {
    it('answers false to all three without a guildId, as in a DM', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction.inGuild()).toBe(false)
      expect(interaction.inCachedGuild()).toBe(false)
      expect(interaction.inRawGuild()).toBe(false)
    })

    it('answers in a guild, but not a cached one, with a guildId alone', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { guildId: '100' })
      expect(interaction.inGuild()).toBe(true)
      expect(interaction.inCachedGuild()).toBe(false)
      expect(interaction.inRawGuild()).toBe(true)
    })

    it('answers in a cached guild with a guildId and a guild', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, {
        guildId: '100',
        guild: createMockGuild(),
      })
      expect(interaction.inGuild()).toBe(true)
      expect(interaction.inCachedGuild()).toBe(true)
      expect(interaction.inRawGuild()).toBe(false)
    })

    it('answers false to all three when member is null or undefined', () => {
      for (const member of [null, undefined]) {
        const interaction = createMockInteraction(ChatInputCommandInteraction, {
          guildId: '100',
          guild: createMockGuild(),
          member: member as any,
        })
        expect(interaction.inGuild()).toBe(false)
        expect(interaction.inCachedGuild()).toBe(false)
        expect(interaction.inRawGuild()).toBe(false)
      }
    })

    it('reads a guildId written after creation', () => {
      const interaction = createMockInteraction(ButtonInteraction)
      ;(interaction as any).guildId = '100'
      expect(interaction.inGuild()).toBe(true)
    })

    it('keeps an explicit return value', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      interaction.inCachedGuild.mockReturnValue(true)
      expect(interaction.inCachedGuild()).toBe(true)
    })

    it('lets a guard that requires a cached guild deny a DM with false', () => {
      class StaffGuard {
        canActivate(interaction: ChatInputCommandInteraction): boolean {
          return interaction.inCachedGuild() && interaction.member.roles.cache.has('staff')
        }
      }
      expect(new StaffGuard().canActivate(createMockInteraction(ChatInputCommandInteraction))).toBe(false)
    })
  })

  describe('locales', () => {
    it('has the user’s locale, and no server locale without a guildId, as in a DM', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      expect(interaction.locale).toBe(Locale.EnglishUS)
      expect(interaction.guildLocale).toBeNull()
    })

    it('has a server locale with a guildId', () => {
      const interaction = createMockInteraction(ButtonInteraction, { guildId: '100' })
      expect(interaction.guildLocale).toBe(Locale.EnglishUS)
    })

    it('keeps the locales it is given', () => {
      const interaction = createMockInteraction(ModalSubmitInteraction, {
        guildId: '100',
        locale: Locale.Indonesian,
        guildLocale: Locale.Japanese,
      })
      expect([interaction.locale, interaction.guildLocale]).toEqual([Locale.Indonesian, Locale.Japanese])
    })

    it('lets a translator pick the server’s language on a default mock', () => {
      const t = createTranslator({ default: 'en-US', locales: { 'en-US': { hi: 'Hello' }, id: { hi: 'Halo' } } })
      expect(t.for(createMockInteraction(ChatInputCommandInteraction), { public: true })('hi')).toBe('Hello')
      expect(t.for(createMockInteraction(ChatInputCommandInteraction, { guildId: '100', guildLocale: Locale.Indonesian }), { public: true })('hi')).toBe('Halo')
    })

    it('adds no locale to a mock that is not an interaction', () => {
      expect(Object.prototype.hasOwnProperty.call(createMockInteraction(User), 'locale')).toBe(false)
    })
  })

  // These assert a compile-time contract, so the gate is `tsc --noEmit -p
  // tsconfig.test.json`, not the runtime assertion. A mock that cannot be handed
  // to the code under test without a cast pushes one cast into every call site.
  describe('assignability to the real discord.js class', () => {
    it('is accepted where the real class is expected, without a cast', () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'gi-profile-1-2' })
      const handler = (received: ButtonInteraction): string => received.customId

      expect(handler(interaction)).toBe('gi-profile-1-2')
    })

    it('keeps the mock API on methods after narrowing to the real class', async () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'x' })
      interaction.reply.mockResolvedValue(undefined)

      await (interaction as ButtonInteraction).reply({ content: 'hi' })

      expect(interaction.reply).toHaveBeenCalledWith({ content: 'hi' })
    })
  })
})

describe('createChatInputOptions', () => {
  describe('subcommand routing', () => {
    it('returns subcommand group', () => {
      const options = createChatInputOptions({ subcommandGroup: 'daily', subcommand: 'notes' })
      expect(options.getSubcommandGroup()).toBe('daily')
    })

    it('returns subcommand', () => {
      const options = createChatInputOptions({ subcommandGroup: 'daily', subcommand: 'notes' })
      expect(options.getSubcommand(true)).toBe('notes')
    })

    it('returns null for missing subcommandGroup when required=false', () => {
      const options = createChatInputOptions({ subcommand: 'notes' })
      expect(options.getSubcommandGroup(false)).toBeNull()
    })

    it('returns null for missing subcommandGroup when not passed', () => {
      const options = createChatInputOptions({ subcommand: 'notes' })
      expect(options.getSubcommandGroup()).toBeNull()
    })

    it('throws for missing subcommandGroup when required=true', () => {
      const options = createChatInputOptions({ subcommand: 'notes' })
      expect(() => options.getSubcommandGroup(true)).toThrow()
    })

    it('throws for missing subcommand when required=true', () => {
      const options = createChatInputOptions({})
      expect(() => options.getSubcommand(true)).toThrow()
    })

    it('does not throw for present subcommand when required=true', () => {
      const options = createChatInputOptions({ subcommand: 'notes' })
      expect(() => options.getSubcommand(true)).not.toThrow()
      expect(options.getSubcommand(true)).toBe('notes')
    })
  })

  describe('value type routing', () => {
    it('getString returns string values', () => {
      const options = createChatInputOptions({ name: 'hutao' })
      expect(options.getString('name')).toBe('hutao')
    })

    it('getNumber returns number values', () => {
      const options = createChatInputOptions({ uid: 12345678 })
      expect(options.getNumber('uid')).toBe(12345678)
    })

    it('getInteger also returns number values', () => {
      const options = createChatInputOptions({ uid: 12345678 })
      expect(options.getInteger('uid')).toBe(12345678)
    })

    it('getBoolean returns boolean values', () => {
      const options = createChatInputOptions({ enabled: true })
      expect(options.getBoolean('enabled')).toBe(true)
    })

    it('getUser returns { id } values', () => {
      const options = createChatInputOptions({ target: { id: 'user-123' } })
      expect(options.getUser('target')).toEqual({ id: 'user-123' })
    })

    it('getRole returns { id } values', () => {
      const options = createChatInputOptions({ role: { id: 'role-abc' } })
      expect(options.getRole('role')).toEqual({ id: 'role-abc' })
    })

    it('getChannel returns { id } values', () => {
      const options = createChatInputOptions({ channel: { id: 'ch-xyz' } })
      expect(options.getChannel('channel')).toEqual({ id: 'ch-xyz' })
    })

    it('getMember returns { id } values', () => {
      const options = createChatInputOptions({ member: { id: 'member-1' } })
      expect(options.getMember('member')).toEqual({ id: 'member-1' })
    })

    it('getMentionable returns { id } values', () => {
      const options = createChatInputOptions({ mention: { id: 'men-1' } })
      expect(options.getMentionable('mention')).toEqual({ id: 'men-1' })
    })
  })

  describe('an option of another type', () => {
    // discord.js reads an option by its type and throws its type error for another, required or not
    it.each([
      ['getNumber', 'hutao', 'Option "x" is of type: 3; expected 10.'],
      ['getInteger', 'hutao', 'Option "x" is of type: 3; expected 4.'],
      ['getString', 12345678, 'Option "x" is of type: 4; expected 3.'],
      ['getBoolean', 'hutao', 'Option "x" is of type: 3; expected 5.'],
      ['getUser', 'hutao', 'Option "x" is of type: 3; expected 6, 9.'],
      ['getAttachment', true, 'Option "x" is of type: 5; expected 11.'],
    ] as const)('%s throws for %j, with or without required', (getter, value, message) => {
      const options = createChatInputOptions({ x: value })
      expect(() => options[getter]('x')).toThrow(message)
      expect(() => options[getter]('x', true)).toThrow(message)
    })

    // A whole number may be an Integer or a Number option; a fraction is only ever a Number
    it('getInteger throws for a fraction, which only a Number option carries', () => {
      const options = createChatInputOptions({ amount: 1.5, count: 2 })
      expect(() => options.getInteger('amount')).toThrow('Option "amount" is of type: 10; expected 4.')
      expect(options.getNumber('amount')).toBe(1.5)
      expect([options.getInteger('count'), options.getNumber('count')]).toEqual([2, 2])
      expect(options.data.map(option => option.type)).toEqual([ApplicationCommandOptionType.Number, ApplicationCommandOptionType.Integer])
    })
  })

  describe('an entity of another kind', () => {
    const entities = () => {
      const guild = createMockGuild()
      return { user: createMockUser(), role: guild.roles.cache.get(guild.id)!, channel: createMockChannel(TextChannel) }
    }

    // A user or a role may be a mentionable option's, which discord.js reads as null for the other kind
    it.each([
      ['getUser', 'role', 'Option "x" is of type: 8; expected 6, 9.'],
      ['getRole', 'user', 'Option "x" is of type: 6; expected 8, 9.'],
    ] as const)('%s reads a %s option as null, and throws when required', (getter, kind, message) => {
      const options = createChatInputOptions({ x: entities()[kind] })
      expect(options[getter]('x')).toBeNull()
      expect(() => options[getter]('x', true)).toThrow(message)
    })

    it.each([
      ['getChannel', 'user', 'Option "x" is of type: 6; expected 7.'],
      ['getMentionable', 'channel', 'Option "x" is of type: 7; expected 9.'],
    ] as const)('%s throws for a %s option, with or without required', (getter, kind, message) => {
      const options = createChatInputOptions({ x: entities()[kind] })
      expect(() => options[getter]('x')).toThrow(message)
      expect(() => options[getter]('x', true)).toThrow(message)
    })

    it('getMember reads a role option as null', () => {
      expect(createChatInputOptions({ x: entities().role }).getMember('x')).toBeNull()
    })

    it('getMentionable reads a user, a member and a role', () => {
      const { user, role } = entities()
      const member = createMockMember({ user })
      const options = createChatInputOptions({ user, member, role })
      expect([options.getMentionable('user'), options.getMentionable('member'), options.getMentionable('role')]).toEqual([user, member, role])
    })
  })

  describe('a user option', () => {
    it("resolves getMember to the user's member in the interaction's server, the one its cache holds", () => {
      const target = createMockUser()
      const guild = createMockGuild()
      const interaction = createMockInteraction(ChatInputCommandInteraction, {
        guildId: guild.id,
        guild,
        options: createChatInputOptions({ target }),
      })

      const member = interaction.options.getMember('target') as GuildMember
      expect(member).toBeInstanceOf(GuildMember)
      expect(member.user).toBe(target)
      expect(member).toBe(guild.members.cache.get(target.id))
      expect(interaction.options.getUser('target')).toBe(target)
    })

    it('resolves getMember to null in a direct message, as Discord sends no member there', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { options: createChatInputOptions({ target: createMockUser() }) })
      expect(interaction.options.getMember('target')).toBeNull()
    })

    it.each([
      ['a user', (user: User) => user],
      ['a member', (user: User) => createMockMember({ user })],
    ])("carries its user, and in a server its member, in its data, as the gateway sends them, for %s given", (_name, given) => {
      const user = createMockUser()
      const guild = createMockGuild()
      const options = createChatInputOptions({ target: given(user) })
      createMockInteraction(ChatInputCommandInteraction, { guildId: guild.id, guild, options })

      const [option] = options.data
      expect(option.user).toBe(user)
      expect(option.member).toBe(options.getMember('target'))
      expect(option.member).toBeInstanceOf(GuildMember)
    })

    it.each([
      ['assigned', (interaction: { options: unknown }, options: unknown) => void (interaction.options = options)],
      ['given through Object.assign', (interaction: { options: unknown }, options: unknown) => void Object.assign(interaction, { options })],
    ])('belongs to the interaction it is %s to after creation', (_how, give) => {
      const target = createMockUser()
      const guild = createMockGuild()
      const inServer = createMockInteraction(ChatInputCommandInteraction, { guildId: guild.id, guild })
      const inDm = createMockInteraction(ChatInputCommandInteraction)
      give(inServer, createChatInputOptions({ target }))
      give(inDm, createChatInputOptions({ target }))

      expect(inServer.options.getMember('target')).toBe(guild.members.cache.get(target.id))
      expect(inDm.options.getMember('target')).toBeNull()
    })

    it('carries no member in its data in a direct message, even one read before', () => {
      const options = createChatInputOptions({ target: createMockUser() })
      expect(options.getMember('target')).toBeInstanceOf(GuildMember)

      createMockInteraction(ChatInputCommandInteraction, { options })

      expect([options.data[0].member, options.getMember('target')]).toEqual([undefined, null])
    })

    it('resolves getUser to the user of a member given', () => {
      const member = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001' }).member as GuildMember
      const options = createChatInputOptions({ target: member })
      expect(options.getUser('target')).toBe(member.user)
      expect(options.getMember('target')).toBe(member)
    })
  })

  describe("discord.js's errors", () => {
    const options = () => createChatInputOptions({ name: 'hutao', channel: createMockChannel(TextChannel) })
    // Each as discord.js throws it: a TypeError with its code, and its own message
    it.each([
      ['a missing required option', () => options().getString('missing', true), DiscordjsErrorCodes.CommandInteractionOptionNotFound, 'Required option "missing" not found.'],
      ['a missing required option, read whole', () => options().get('missing', true), DiscordjsErrorCodes.CommandInteractionOptionNotFound, 'Required option "missing" not found.'],
      ['an option of another type', () => options().getInteger('name'), DiscordjsErrorCodes.CommandInteractionOptionType, 'Option "name" is of type: 3; expected 4.'],
      ['a message read from a slash command', () => options().getMessage('name'), DiscordjsErrorCodes.CommandInteractionOptionType, 'Option "name" is of type: 3; expected _MESSAGE.'],
      ['no subcommand, required by default', () => options().getSubcommand(), DiscordjsErrorCodes.CommandInteractionOptionNoSubcommand, 'No subcommand specified for interaction.'],
      ['no subcommand group, required', () => options().getSubcommandGroup(true), DiscordjsErrorCodes.CommandInteractionOptionNoSubcommandGroup, 'No subcommand group specified for interaction.'],
      [
        'a channel of a type not allowed',
        () => options().getChannel('channel', false, [ChannelType.GuildVoice]),
        'CommandInteractionOptionInvalidChannelType' as DiscordjsErrorCodes,
        'The type of channel of the option "channel" is: 0; expected 2.',
      ],
      ['no focused option', () => options().getFocused(), DiscordjsErrorCodes.AutocompleteInteractionOptionNoFocusedOption, 'No focused option for autocomplete interaction.'],
    ] as const)('throws for %s', (_case, read, code, message) => {
      expect(read).toThrow(message)
      expect(read).toThrow(expect.objectContaining({ code, name: `DiscordjsTypeError [${code}]` }))
      expect(read).toThrow(TypeError)
    })

    it('reads an option whole, a missing message option, a channel of an allowed type and no subcommand when not required, as discord.js does', () => {
      expect(options().getMessage('missing')).toBeNull()
      expect(options().get('name')).toMatchObject({ name: 'name', type: ApplicationCommandOptionType.String, value: 'hutao' })
      expect(options().get('missing')).toBeNull()
      expect(options().getChannel('channel', false, [ChannelType.GuildText])).toBeInstanceOf(TextChannel)
      expect(options().getSubcommand(false)).toBeNull()
    })
  })

  describe('missing option behaviour', () => {
    it('returns null for absent option', () => {
      const options = createChatInputOptions({})
      expect(options.getString('missing')).toBeNull()
    })

    it('throws for absent option when required=true', () => {
      const options = createChatInputOptions({})
      expect(() => options.getString('missing', true)).toThrow('Required option "missing" not found.')
    })

    it('returns null for absent option when required=false', () => {
      const options = createChatInputOptions({})
      expect(options.getString('missing', false)).toBeNull()
    })
  })

  describe('methods are mock functions — configurable per test', () => {
    it('getNumber is a mock function', () => {
      const options = createChatInputOptions({ uid: 12345678 })
      expect(vi.isMockFunction(options.getNumber)).toBe(true)
    })

    it('can override getNumber return value per test', () => {
      const options = createChatInputOptions({ uid: 12345678 })
      options.getNumber.mockReturnValue(999)
      expect(options.getNumber('uid')).toBe(999)
    })
  })

  it('getAttachment returns the attachment given, as an Attachment option carries it', () => {
    const file = createMockInteraction(Attachment, { id: '1', name: 'log.txt' })
    const options = createChatInputOptions({ file })
    expect(options.getAttachment('file')).toBe(file)
    expect(options.getAttachment('other')).toBeNull()
    expect(() => options.getAttachment('other', true)).toThrow('Required option "other" not found.')
  })

  describe('unlisted methods fall through to auto-stub', () => {
    it('getMessage is auto-stubbed as a mock function', () => {
      const options = createChatInputOptions({})
      expect(vi.isMockFunction((options as any).getMessage)).toBe(true)
    })
  })
})

describe('overrideGuard()', () => {
  // Minimal controller setup helper
  function makeController(guardClass: new (...args: any[]) => GuardInterface) {
    class TestController {
      executed = false

      @UseGuard(guardClass)
      async handle(_ctx: any) {
        this.executed = true
      }
    }
    return TestController
  }

  it('guard stub with canActivate: () => false blocks method execution', async () => {
    @Guard()
    class BlockingGuard implements GuardInterface {
      canActivate() {
        return false
      }
    }

    const TestController = makeController(BlockingGuard)

    const module = MeoCordTestingModule.create({ controllers: [TestController] })
      .overrideGuard(BlockingGuard)
      .useValue({ canActivate: () => false })
      .compile()

    const ctrl = module.get(TestController)
    await ctrl.handle(createMockInteraction(BaseInteraction))
    expect(ctrl.executed).toBe(false)
  })

  it('guard stub with canActivate: () => true allows method execution', async () => {
    @Guard()
    class RealGuard implements GuardInterface {
      // Would normally need DI deps — but override replaces it entirely
      canActivate() {
        return false
      } // real impl denies
    }

    const TestController = makeController(RealGuard)

    const module = MeoCordTestingModule.create({ controllers: [TestController] })
      .overrideGuard(RealGuard)
      .useValue({ canActivate: () => true })
      .compile()

    const ctrl = module.get(TestController)
    await ctrl.handle(createMockInteraction(BaseInteraction))
    expect(ctrl.executed).toBe(true)
  })

  it('overriding a guard requires no DI dependencies for that guard', async () => {
    @Guard()
    class GuardWithDeps implements GuardInterface {
      constructor(_someService: unknown) {}
      canActivate() {
        return true
      }
    }

    const TestController = makeController(GuardWithDeps)

    // No providers for GuardWithDeps or its deps — should not throw
    expect(() =>
      MeoCordTestingModule.create({ controllers: [TestController] })
        .overrideGuard(GuardWithDeps)
        .useValue({ canActivate: () => true })
        .compile(),
    ).not.toThrow()
  })

  it('chains multiple overrideGuard calls', async () => {
    const order: string[] = []

    @Guard()
    class GuardA implements GuardInterface {
      canActivate() {
        order.push('A')
        return true
      }
    }

    @Guard()
    class GuardB implements GuardInterface {
      canActivate() {
        order.push('B')
        return true
      }
    }

    class TestController {
      executed = false

      @UseGuard(GuardA, GuardB)
      async handle(_ctx: any) {
        this.executed = true
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [TestController] })
      .overrideGuard(GuardA)
      .useValue({
        canActivate: () => {
          order.push('stubA')
          return true
        },
      })
      .overrideGuard(GuardB)
      .useValue({
        canActivate: () => {
          order.push('stubB')
          return true
        },
      })
      .compile()

    const ctrl = module.get(TestController)
    await ctrl.handle(createMockInteraction(BaseInteraction))

    expect(order).toEqual(['stubA', 'stubB'])
    expect(ctrl.executed).toBe(true)
  })
})

describe('createMockMessage', () => {
  it('returns a Message instance', () => {
    expect(createMockMessage()).toBeInstanceOf(Message)
  })

  it('gives the time it was made with its generated id, the time an id the test gives encodes, and a set time', () => {
    const before = Date.now()
    const made = createMockMessage()
    const given = createMockMessage({ id: '1200000000000000000' })
    const set = createMockMessage()
    set.createdTimestamp = 42

    expect(made.createdTimestamp).toBeGreaterThanOrEqual(before)
    expect(made.createdAt).toEqual(new Date(made.createdTimestamp))
    expect(given.createdTimestamp).toBe(SnowflakeUtil.timestampFrom('1200000000000000000'))
    expect(set.createdTimestamp).toBe(42)
  })

  it('comes from a user rather than a bot, with the content given, so dispatch handles it', () => {
    const msg = createMockMessage({ content: '!roll 20' })

    expect(msg.content).toBe('!roll 20')
    expect(msg.author.bot).toBe(false)
  })

  it('is a DM when given no guild, and sits in the guild it is given', () => {
    expect([createMockMessage({ guild: null }).guild, createMockMessage({ guild: null }).guildId]).toEqual([null, null])
    const guild = createMockGuild({ id: '300' })
    const message = createMockMessage({ guild })
    expect([message.guild, message.guildId]).toEqual([guild, '300'])
  })

  it("keeps a guild's members and roles in real caches, by id", () => {
    const member = createMock<GuildMember>({ id: '1' })
    const guild = createMockGuild({ members: [member] })
    expect(guild.members.cache.get('1')).toBe(member)
    // Every server has its @everyone role, with the server's id
    expect([...guild.roles.cache.keys()]).toEqual([guild.id])
    expect(createMockMessage().guild!.members.cache.get('1')).toBeUndefined()
  })

  it('starts as an empty message: no flags, components, embeds or attachments', () => {
    const msg = createMockMessage()

    expect(msg.flags.has(MessageFlags.Ephemeral)).toBe(false)
    expect(msg.components).toEqual([])
    expect(msg.embeds).toEqual([])
    expect(msg.attachments.size).toBe(0)
  })

  it('methods are auto-stubbed as mock functions', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction(msg.edit)).toBe(true)
    expect(vi.isMockFunction(msg.react)).toBe(true)
  })

  it('deleted starts as false', () => {
    expect((createMockMessage() as any).deleted).toBe(false)
  })

  it('delete() sets deleted to true', async () => {
    const msg = createMockMessage()
    await msg.delete()
    expect((msg as any).deleted).toBe(true)
  })

  it('delete() twice throws', async () => {
    const msg = createMockMessage()
    await msg.delete()
    await expect(msg.delete()).rejects.toThrow()
  })

  it('edit() after delete() throws', async () => {
    const msg = createMockMessage()
    await msg.delete()
    await expect(msg.edit({ content: 'new' })).rejects.toThrow()
  })

  it('reply() after delete() throws', async () => {
    const msg = createMockMessage()
    await msg.delete()
    await expect(msg.reply({ content: 'hi' })).rejects.toThrow()
  })

  it('react() after delete() throws', async () => {
    const msg = createMockMessage()
    await msg.delete()
    await expect(msg.react('👍')).rejects.toThrow()
  })

  it('edit() resolves to a Message instance', async () => {
    const result = await createMockMessage().edit({ content: 'updated' })
    expect(result).toBeInstanceOf(Message)
  })

  it('reply() resolves to a Message instance', async () => {
    const result = await createMockMessage().reply({ content: 'hi' })
    expect(result).toBeInstanceOf(Message)
  })

  it('delete() is a mock function — call assertions still work', async () => {
    const msg = createMockMessage()
    await msg.delete()
    expect(msg.delete).toHaveBeenCalledTimes(1)
  })

  it('msg.author is a User instance', () => {
    const msg = createMockMessage()
    expect(msg.author).toBeInstanceOf(User)
  })

  it('msg.author.send is a mock function', () => {
    expect(vi.isMockFunction(createMockMessage().author.send)).toBe(true)
  })

  it('msg.member is a GuildMember-like object with fetch', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction((msg.member as any)?.fetch)).toBe(true)
  })

  it('msg.member.fetch.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    ;(msg.member as any).fetch.mockResolvedValue(true)
    await expect((msg.member as any).fetch()).resolves.toBe(true)
  })

  it('msg.channel is a TextChannel-like object with send', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction((msg.channel).send)).toBe(true)
  })

  it('msg.guild is a Guild-like object with members', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction((msg.guild as any).members.fetch)).toBe(true)
  })

  it('msg.thread is a ThreadChannel-like object', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction((msg.thread as any).fetch)).toBe(true)
  })

  it('msg.mentions.has is a mock function', () => {
    const msg = createMockMessage()
    expect(vi.isMockFunction((msg.mentions as any).has)).toBe(true)
  })

  it('msg.mentions.members is an object', () => {
    const msg = createMockMessage()
    expect((msg.mentions as any).members).toBeDefined()
    expect(typeof (msg.mentions as any).members).toBe('object')
  })

  it('msg.author.send.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    ;(msg.author.send).mockResolvedValue(createMockMessage())
    const result = await msg.author.send({ content: 'hi' })
    expect(result).toBeInstanceOf(Message)
  })

  it('msg.member.fetch.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    const member = createMockUser()
    ;(msg.member as any).fetch.mockResolvedValue(member)
    const result = await (msg.member as any).fetch()
    expect(result).toBe(member)
  })

  it('msg.member.fetch.mockRejectedValue works', async () => {
    const msg = createMockMessage()
    ;(msg.member as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((msg.member as any).fetch()).rejects.toThrow('not found')
  })

  it('msg.channel.send.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    const reply = createMockMessage()
    ;(msg.channel).send.mockResolvedValue(reply)
    const result = await (msg.channel).send({ content: 'hi' })
    expect(result).toBe(reply)
  })

  it('msg.channel.send.mockRejectedValue works', async () => {
    const msg = createMockMessage()
    ;(msg.channel).send.mockRejectedValue(new Error('cannot send'))
    await expect((msg.channel).send({ content: 'hi' })).rejects.toThrow('cannot send')
  })

  it('msg.guild.members.fetch.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    const member = createMockUser()
    ;(msg.guild as any).members.fetch.mockResolvedValue(member)
    const result = await (msg.guild as any).members.fetch('user-123')
    expect(result).toBe(member)
  })

  it('msg.thread.fetch.mockResolvedValue works', async () => {
    const msg = createMockMessage()
    const thread = createMockChannel(ThreadChannel as any)
    ;(msg.thread as any).fetch.mockResolvedValue(thread)
    const result = await (msg.thread as any).fetch()
    expect(result).toBe(thread)
  })

  it('msg.thread.fetch.mockRejectedValue works', async () => {
    const msg = createMockMessage()
    ;(msg.thread as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((msg.thread as any).fetch()).rejects.toThrow('not found')
  })

  describe('overrides', () => {
    const row: APIActionRowComponent<APIComponentInMessageActionRow> = {
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Primary, custom_id: 'card/refresh', label: 'Refresh' }],
    }

    it('takes the id and content', () => {
      const msg = createMockMessage({ id: '123456789012345678', content: 'Hello' })

      expect(msg.id).toBe('123456789012345678')
      expect(msg.content).toBe('Hello')
    })

    it('gives components from API JSON or builders the API JSON as their toJSON()', () => {
      const built = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('card/refresh').setLabel('Refresh').setStyle(ButtonStyle.Primary),
      )
      const msg = createMockMessage({ components: [row, built] })

      expect(msg.components.map(component => component.toJSON())).toEqual([row, row])
    })

    it('gives embeds from API JSON or builders the API JSON as their toJSON()', () => {
      const msg = createMockMessage({ embeds: [{ title: 'Card' }, new EmbedBuilder().setTitle('Built')] })

      expect(msg.embeds.map(embed => embed.toJSON())).toEqual([{ title: 'Card' }, { title: 'Built' }])
    })

    it('keeps discord.js components and embeds as they are', () => {
      const original = createMockMessage({ components: [row], embeds: [{ title: 'Card' }] })
      const msg = createMockMessage({ components: original.components, embeds: original.embeds })

      expect(msg.components[0].toJSON()).toEqual(row)
      expect(msg.embeds[0].toJSON()).toEqual({ title: 'Card' })
    })

    it('reads flags as a number, flag names or a bitfield', () => {
      expect(createMockMessage({ flags: MessageFlags.Ephemeral }).flags.has(MessageFlags.Ephemeral)).toBe(true)
      expect(createMockMessage({ flags: ['IsComponentsV2'] }).flags.has(MessageFlags.IsComponentsV2)).toBe(true)
      expect(createMockMessage({ flags: MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds }).flags.toArray()).toEqual([
        'SuppressEmbeds',
        'Ephemeral',
      ])
    })

    it('copies what it is given, so changing the array afterwards leaves the message alone', () => {
      const components = [row]
      const msg = createMockMessage({ components })
      components.pop()

      expect(msg.components).toHaveLength(1)
    })

    it('leaves the rest of the message as the default call does', () => {
      const msg = createMockMessage({ content: 'Hello' })

      expect(msg.flags.bitfield).toBe(0)
      expect(msg.embeds).toEqual([])
      expect(vi.isMockFunction(msg.edit)).toBe(true)
    })
  })
})

describe('createMockUser', () => {
  it('returns a User instance', () => {
    expect(createMockUser()).toBeInstanceOf(User)
  })

  it('send() is a mock function', () => {
    const user = createMockUser()
    expect(vi.isMockFunction(user.send)).toBe(true)
  })

  it('send() can be asserted on', async () => {
    const user = createMockUser()
    await user.send({ embeds: [] })
    expect(user.send).toHaveBeenCalledWith({ embeds: [] })
  })

  it('createDM() is a mock function', () => {
    expect(vi.isMockFunction(createMockUser().createDM)).toBe(true)
  })
})

describe('createMockClient', () => {
  it('returns a Client instance', () => {
    expect(createMockClient()).toBeInstanceOf(Client)
  })

  it('client.users and client.guilds are independent nested stubs', () => {
    const client = createMockClient()
    expect(client.users).not.toBe(client.guilds)
  })

  it('client.users.fetch is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.users as any).fetch)).toBe(true)
  })

  it('client.channels.fetch is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.channels as any).fetch)).toBe(true)
  })

  it('client.guilds.fetch is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.guilds as any).fetch)).toBe(true)
  })

  it('client.application.commands.fetch is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.application as any).commands.fetch)).toBe(true)
  })

  it('client.application.commands.set is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.application as any).commands.set)).toBe(true)
  })

  it('client.user.avatarURL is a mock function by default', () => {
    const client = createMockClient()
    expect(vi.isMockFunction((client.user as any).avatarURL)).toBe(true)
  })

  it('client.users.fetch can be overridden to resolve a mock user', async () => {
    const client = createMockClient()
    const user = createMockUser()
    ;(client.users as any).fetch = vi.fn(() => Promise.resolve(user))
    const result = await (client.users as any).fetch('user-123')
    expect(result).toBe(user)
    expect((client.users as any).fetch).toHaveBeenCalledWith('user-123')
  })

  it('client.users.fetch resolves and can be asserted without override', async () => {
    const client = createMockClient()
    await (client.users as any).fetch('user-123')
    expect((client.users as any).fetch).toHaveBeenCalledWith('user-123')
  })

  it('client.users.fetch.mockResolvedValue works', async () => {
    const client = createMockClient()
    const user = createMockUser()
    ;(client.users as any).fetch.mockResolvedValue(user)
    const result = await (client.users as any).fetch('user-123')
    expect(result).toBe(user)
  })

  it('client.users.fetch.mockRejectedValue works', async () => {
    const client = createMockClient()
    ;(client.users as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((client.users as any).fetch('user-123')).rejects.toThrow('not found')
  })

  it('client.channels.fetch.mockResolvedValue works', async () => {
    const client = createMockClient()
    const channel = createMockChannel(TextChannel)
    ;(client.channels as any).fetch.mockResolvedValue(channel)
    const result = await (client.channels as any).fetch('ch-123')
    expect(result).toBe(channel)
  })

  it('client.channels.fetch.mockRejectedValue works', async () => {
    const client = createMockClient()
    ;(client.channels as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((client.channels as any).fetch('ch-123')).rejects.toThrow('not found')
  })

  it('client.guilds.fetch.mockResolvedValue works', async () => {
    const client = createMockClient()
    const guild = createMockGuild()
    ;(client.guilds).fetch.mockResolvedValue(guild)
    const result = await (client.guilds as any).fetch('guild-123')
    expect(result).toBe(guild)
  })

  it('client.guilds.fetch.mockRejectedValue works', async () => {
    const client = createMockClient()
    ;(client.guilds as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((client.guilds as any).fetch('guild-123')).rejects.toThrow('not found')
  })
})

describe('createMockGuild', () => {
  it('returns a Guild instance', () => {
    expect(createMockGuild()).toBeInstanceOf(Guild)
  })

  it('guild.members.fetch is a mock function by default', () => {
    expect(vi.isMockFunction((createMockGuild().members as any).fetch)).toBe(true)
  })

  it('guild.channels.fetch is a mock function by default', () => {
    expect(vi.isMockFunction((createMockGuild().channels as any).fetch)).toBe(true)
  })

  it('guild.roles.fetch is a mock function by default', () => {
    expect(vi.isMockFunction((createMockGuild().roles as any).fetch)).toBe(true)
  })

  it('guild.bans.fetch is a mock function by default', () => {
    expect(vi.isMockFunction((createMockGuild().bans as any).fetch)).toBe(true)
  })

  it('guild.members.fetch and guild.channels.fetch are independent stubs', () => {
    const guild = createMockGuild()
    expect((guild.members as any).fetch).not.toBe((guild.channels as any).fetch)
  })

  it('guild.members.fetch.mockResolvedValue works', async () => {
    const guild = createMockGuild()
    const member = createMockUser() // close enough structurally
    ;(guild.members).fetch.mockResolvedValue(member)
    const result = await (guild.members as any).fetch('member-123')
    expect(result).toBe(member)
  })

  it('guild.members.fetch.mockRejectedValue works', async () => {
    const guild = createMockGuild()
    ;(guild.members as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((guild.members as any).fetch('member-123')).rejects.toThrow('not found')
  })

  it('guild.channels.fetch.mockResolvedValue works', async () => {
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel)
    ;(guild.channels).fetch.mockResolvedValue(channel)
    const result = await (guild.channels as any).fetch('ch-123')
    expect(result).toBe(channel)
  })

  it('guild.channels.fetch.mockRejectedValue works', async () => {
    const guild = createMockGuild()
    ;(guild.channels as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((guild.channels as any).fetch('ch-123')).rejects.toThrow('not found')
  })
})

describe('createMockChannel', () => {
  it('returns a TextChannel instance', () => {
    expect(createMockChannel(TextChannel)).toBeInstanceOf(TextChannel)
  })

  it('send() is a mock function', () => {
    const channel = createMockChannel(TextChannel)
    expect(vi.isMockFunction(channel.send)).toBe(true)
  })

  it('send() can be asserted on', async () => {
    const channel = createMockChannel(TextChannel)
    await channel.send({ content: 'hi' })
    expect(channel.send).toHaveBeenCalledWith({ content: 'hi' })
  })

  it('channel.messages.fetch is a mock function by default (TextChannel)', () => {
    const channel = createMockChannel(TextChannel)
    expect(vi.isMockFunction((channel.messages as any).fetch)).toBe(true)
  })

  it('channel.threads.fetch is a mock function by default (TextChannel)', () => {
    const channel = createMockChannel(TextChannel)
    expect(vi.isMockFunction((channel.threads as any).fetch)).toBe(true)
  })

  it('channel.messages.fetch is a mock function by default (DMChannel)', () => {
    const channel = createMockChannel(DMChannel as any)
    expect(vi.isMockFunction((channel as any).messages.fetch)).toBe(true)
  })

  it('channel.messages.fetch is a mock function by default (ThreadChannel)', () => {
    const channel = createMockChannel(ThreadChannel as any)
    expect(vi.isMockFunction((channel as any).messages.fetch)).toBe(true)
  })

  it('channel.members.fetch is a mock function by default (ThreadChannel)', () => {
    const channel = createMockChannel(ThreadChannel as any)
    expect(vi.isMockFunction((channel as any).members.fetch)).toBe(true)
  })

  // A text or announcement channel's threads come from GuildTextThreadManager, whose create() the
  // ThreadManager base lacks; a forum or media channel's from GuildForumThreadManager
  it.each([TextChannel, NewsChannel, ForumChannel, MediaChannel])('threads.create is a mock function (%o)', Class => {
    const channel = createMockChannel(Class as typeof TextChannel) as unknown as { threads: { create: unknown } }
    expect(vi.isMockFunction(channel.threads.create)).toBe(true)
  })

  it('gives a subclass the managers of the class it extends', () => {
    class StaffChannel extends TextChannel {}
    const channel = createMockChannel(StaffChannel)
    expect(vi.isMockFunction(channel.messages.fetch)).toBe(true)
    expect(vi.isMockFunction(channel.threads.create)).toBe(true)
  })

  it('channel.messages.fetch.mockResolvedValue works (TextChannel)', async () => {
    const channel = createMockChannel(TextChannel)
    const msg = createMockMessage()
    ;(channel.messages).fetch.mockResolvedValue(msg)
    const result = await (channel.messages as any).fetch('msg-123')
    expect(result).toBe(msg)
  })

  it('channel.messages.fetch.mockRejectedValue works (TextChannel)', async () => {
    const channel = createMockChannel(TextChannel)
    ;(channel.messages as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((channel.messages as any).fetch('msg-123')).rejects.toThrow('not found')
  })

  it('channel.threads.fetch.mockResolvedValue works (TextChannel)', async () => {
    const channel = createMockChannel(TextChannel)
    ;(channel.threads).fetch.mockResolvedValue('thread-result')
    const result = await (channel.threads as any).fetch('thread-123')
    expect(result).toBe('thread-result')
  })

  it('channel.threads.fetch.mockRejectedValue works (TextChannel)', async () => {
    const channel = createMockChannel(TextChannel)
    ;(channel.threads as any).fetch.mockRejectedValue(new Error('not found'))
    await expect((channel.threads as any).fetch('thread-123')).rejects.toThrow('not found')
  })
})

// createMockInteraction needs a class to build a prototype chain from. A service
// double has no such requirement and often no runtime class at all -- an injected
// dependency may be an interface. createMock covers that case: every method is a
// mock fn, nothing is a real instance of anything.
describe('createMock', () => {
  class NotificationService {
    private readonly prefix = '[bot] '

    async notify(message: string): Promise<string> {
      return this.prefix + message
    }

    async broadcast(message: string): Promise<string> {
      return this.prefix + message
    }
  }

  interface Cache {
    get(key: string): string | null
    nested: { flush(): void }
  }

  it("keeps an interaction's answer methods' keys those of any mock function", () => {
    const interaction = createMockInteraction(ButtonInteraction)

    expect(Object.keys(interaction.reply).sort()).toEqual(Object.keys(createMockFn()).sort())
  })

  it('keeps the nested stubs it makes out of a member’s own keys', () => {
    const cache = createMock<Cache>()
    const before = Object.keys(cache.nested)

    cache.nested.flush()

    expect(Object.keys(cache.nested)).toEqual(before)
    expect(before).not.toContain('flush')
  })

  it('auto-stubs every method as a mock fn', () => {
    const service = createMock<NotificationService>()

    expect(vi.isMockFunction(service.notify)).toBe(true)
    expect(vi.isMockFunction(service.broadcast)).toBe(true)
  })

  it('records calls so assertions work normally', async () => {
    const service = createMock<NotificationService>()

    await service.notify('hello')

    expect(service.notify).toHaveBeenCalledWith('hello')
    expect(service.notify).toHaveBeenCalledTimes(1)
  })

  it('takes a return value per method', async () => {
    const service = createMock<NotificationService>()
    service.notify.mockResolvedValue('[bot] hello')

    await expect(service.notify('hello')).resolves.toBe('[bot] hello')
  })

  it('works for an interface, which has no runtime class to pass', () => {
    const cache = createMock<Cache>()

    expect(vi.isMockFunction(cache.get)).toBe(true)
  })

  it('stubs nested objects rather than returning undefined', () => {
    const cache = createMock<Cache>()

    expect(vi.isMockFunction(cache.nested.flush)).toBe(true)
  })

  it('applies construction-time props', async () => {
    const service = createMock<NotificationService>({ notify: async () => 'from props' })

    await expect(service.notify('hello')).resolves.toBe('from props')
  })

  it('keeps each mock independent between instances', () => {
    const a = createMock<NotificationService>()
    const b = createMock<NotificationService>()

    void a.notify('only a')

    expect(a.notify).toHaveBeenCalledTimes(1)
    expect(b.notify).not.toHaveBeenCalled()
  })
})

describe('methods that return a promise in discord.js', () => {
  it('resolves send to a message, so a .catch() chain works', async () => {
    const client = createMockClient()
    const channel = createMockChannel(TextChannel)

    await expect(client.users.send('1', { content: 'hi' }).catch(() => undefined)).resolves.toBeInstanceOf(Message)
    await expect(channel.send({ content: 'hi' })).resolves.toBeInstanceOf(Message)
    await expect(createMockUser().send('hi')).resolves.toBeInstanceOf(Message)
    await expect(createMockInteraction(GuildMember).send('hi')).resolves.toBeInstanceOf(Message)
  })

  it('resolves a manager’s fetch by one id to that item, and a list fetch to an empty collection', async () => {
    const client = createMockClient()
    const guild = createMockGuild()
    const channel = createMockChannel(TextChannel)

    await expect(client.users.fetch('1')).resolves.toBeInstanceOf(User)
    await expect(client.guilds.fetch('1')).resolves.toBeInstanceOf(Guild)
    await expect(client.channels.fetch('1')).resolves.toBeInstanceOf(TextChannel)
    await expect(guild.members.fetch('1')).resolves.toBeInstanceOf(GuildMember)
    await expect(guild.members.fetch({ user: '1' })).resolves.toBeInstanceOf(GuildMember)
    await expect(guild.roles.fetch('1')).resolves.toBeInstanceOf(Role)
    await expect(channel.messages.fetch('1')).resolves.toBeInstanceOf(Message)

    const members = await guild.members.fetch()
    expect(members).toBeInstanceOf(Collection)
    expect(members.size).toBe(0)
    expect(await channel.messages.fetch({ limit: 10 })).toEqual(new Collection())
  })

  it('resolves what a manager creates to a mock of it', async () => {
    const client = createMockClient()
    const guild = createMockGuild()

    await expect(createMockChannel(TextChannel).threads.create({ name: 't' })).resolves.toBeInstanceOf(ThreadChannel)
    await expect(guild.roles.create({ name: 'r' })).resolves.toBeInstanceOf(Role)
    await expect(guild.channels.create({ name: 'c' })).resolves.toBeInstanceOf(TextChannel)
    await expect(client.users.createDM('1')).resolves.toBeInstanceOf(DMChannel)
  })

  it('resolves an edit or a setter on a structure to the structure itself', async () => {
    const thread = createMockChannel(ThreadChannel)
    const member = createMockInteraction(GuildMember)

    await expect(thread.setLocked(true)).resolves.toBe(thread)
    await expect(thread.setArchived(true)).resolves.toBe(thread)
    await expect(member.edit({ nick: 'n' })).resolves.toBe(member)
    await expect(member.fetch()).resolves.toBe(member)
  })

  it('returns a promise from every other method discord.js declares async', async () => {
    const typing = createMockChannel(TextChannel).sendTyping()

    expect(typing).toBeInstanceOf(Promise)
    await expect(typing).resolves.toBeUndefined()
  })

  it('leaves methods that return a value synchronously alone', () => {
    const client = createMockClient()

    expect(client.user?.setPresence({ status: 'idle' })).toBeUndefined()
  })

  it('still lets a test choose what a method resolves to', async () => {
    const client = createMockClient()
    client.users.fetch.mockResolvedValue(createMockUser())
    client.users.send.mockRejectedValue(new Error('Cannot send messages to this user'))

    await expect(client.users.send('1', 'hi')).rejects.toThrow('Cannot send messages to this user')
  })
})

/** A collection of `items` by id, as discord.js keys a select menu's choices. */
const collection = (...items: { id: string }[]) => new Collection(items.map(item => [item.id, item]))

describe("a mock select menu's choices", () => {
  // discord.js builds `values` and a collection per kind of choice from what Discord sends, empty when none was picked
  it.each([
    ['StringSelectMenuInteraction', StringSelectMenuInteraction, []],
    ['UserSelectMenuInteraction', UserSelectMenuInteraction, ['users', 'members']],
    ['RoleSelectMenuInteraction', RoleSelectMenuInteraction, ['roles']],
    ['ChannelSelectMenuInteraction', ChannelSelectMenuInteraction, ['channels']],
    ['MentionableSelectMenuInteraction', MentionableSelectMenuInteraction, ['users', 'members', 'roles']],
  ] as const)('are no values, and an empty collection of each kind it picks, for a %s', (_name, Class, kinds) => {
    const interaction = createMockInteraction(Class as never, { customId: 'pick' }) as unknown as Record<string, unknown>

    expect(interaction.values).toEqual([])
    for (const kind of kinds) {
      expect(interaction[kind]).toBeInstanceOf(Collection)
      expect((interaction[kind] as Collection<string, unknown>).map(item => item)).toEqual([])
    }
  })

  it.each([
    ['users', UserSelectMenuInteraction, () => ({ users: collection(createMockUser()) })],
    ['members alone', UserSelectMenuInteraction, () => ({ members: collection(createMockMember()) })],
    ['roles', RoleSelectMenuInteraction, () => ({ roles: collection(createMockInteraction(Role, {})) })],
    ['users and roles', MentionableSelectMenuInteraction, () => ({ users: collection(createMockUser()), roles: collection(createMockInteraction(Role, {})) })],
  ] as const)('are the ids of the %s given, as Discord sends them in values', (_name, Class, picked) => {
    const choices = picked() as Record<string, Collection<string, unknown>>
    const interaction = createMockInteraction(Class as never, { customId: 'pick', ...choices }) as unknown as { values: string[] }

    expect(interaction.values).toEqual(Object.values(choices).flatMap(given => [...given.keys()]))
  })

  it('keeps the values and collections a test gives', () => {
    const user = createMockUser()
    const users = new Collection([[user.id, user]])
    const interaction = createMockInteraction(UserSelectMenuInteraction, { customId: 'pick', values: [user.id], users })

    expect([interaction.values, interaction.users, interaction.members.size]).toEqual([[user.id], users, 0])
  })
})
