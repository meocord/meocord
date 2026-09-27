import { describe, it, expectTypeOf } from 'vitest'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  TextChannel,
  TextInputStyle,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ThreadChannel,
  User,
  UserContextMenuCommandInteraction,
} from 'discord.js'
import {
  createChatInputOptions,
  createMock,
  createMockChannel,
  createMockInteraction,
  createMockMessage,
  createMockUser,
  type DeepMocked,
  type MockMessageOverrides,
  type MockProps,
} from './mock-interaction.js'
import type { MockedFunction } from './mock-fn.js'

/**
 * Type-level assertions, run by `vitest --typecheck`. An unfulfilled `@ts-expect-error` fails, so a
 * form that should be rejected cannot start compiling unnoticed.
 */

describe('DeepMocked', () => {
  it('is assignable to the class it mocks', () => {
    const interaction = createMockInteraction(ButtonInteraction)
    expectTypeOf(interaction).toExtend<ButtonInteraction>()
  })

  it('is assignable for every interaction class the factories cover', () => {
    expectTypeOf(createMockInteraction(ChatInputCommandInteraction)).toExtend<ChatInputCommandInteraction>()
    expectTypeOf(createMockInteraction(StringSelectMenuInteraction)).toExtend<StringSelectMenuInteraction>()
    expectTypeOf(createMockInteraction(ModalSubmitInteraction)).toExtend<ModalSubmitInteraction>()
    expectTypeOf(createMockUser()).toExtend<User>()
    // Tracked by the mock and documented, so it is part of the type a test reads.
    expectTypeOf(createMockMessage().deleted).toEqualTypeOf<boolean>()
  })

  it('keeps the mock API on methods', () => {
    const interaction = createMockInteraction(ButtonInteraction)
    expectTypeOf(interaction.reply).toExtend<MockedFunction<(...args: never[]) => unknown>>()
    expectTypeOf(interaction.reply.mockResolvedValue).toBeFunction()
  })

  it('keeps the real call signature on methods', () => {
    const interaction = createMockInteraction(ButtonInteraction)
    expectTypeOf(interaction.isButton()).toEqualTypeOf<boolean>()
    expectTypeOf(interaction.customId).toEqualTypeOf<string>()
  })

  it('leaves a writable property writable', () => {
    const interaction = createMockInteraction(ButtonInteraction)
    interaction.customId = 'gi-profile-1-2'
    expectTypeOf(interaction.customId).toEqualTypeOf<string>()
  })

  it('rejects a write to a property the class declares readonly', () => {
    const interaction = createMockInteraction(ModalSubmitInteraction)
    // @ts-expect-error customId is `readonly` on ModalSubmitInteraction — pass it
    // to the factory as MockProps rather than assigning after construction.
    interaction.customId = 'gi-wish-import-1'
  })

  it('does not collapse a nested object to a bare mock', () => {
    const interaction = createMockInteraction(ButtonInteraction)
    expectTypeOf(interaction.user).toExtend<User>()
  })
})

describe('MockProps', () => {
  it('accepts a plain property', () => {
    expectTypeOf(createMockInteraction(ButtonInteraction, { customId: 'x' })).toExtend<ButtonInteraction>()
  })

  it('accepts a property the class declares readonly', () => {
    expectTypeOf(createMockInteraction(ModalSubmitInteraction, { customId: 'x' })).toExtend<ModalSubmitInteraction>()
  })

  it('accepts a property backed by a prototype getter', () => {
    expectTypeOf(
      createMockInteraction(UserContextMenuCommandInteraction, { targetUser: createMockUser() }),
    ).toExtend<UserContextMenuCommandInteraction>()
  })

  it('rejects a value of the wrong type', () => {
    // @ts-expect-error customId is a string, not a number.
    createMockInteraction(ButtonInteraction, { customId: 123 })
  })

  it('rejects a property the class does not declare', () => {
    // @ts-expect-error typo in the property name — excess property checking is
    // the whole reason MockProps is typed rather than Record<string, unknown>.
    createMockInteraction(ButtonInteraction, { customID: 'x' })
  })

  it('leaves every property optional', () => {
    expectTypeOf<MockProps<ButtonInteraction>>().toExtend<Record<string, never> | object>()
    expectTypeOf(createMockInteraction(ButtonInteraction, {})).toExtend<ButtonInteraction>()
  })
})

// The single most common line of setup in a slash-command test. It has to work
// without a cast, or the cast spreads to every chat-input spec in every project.
describe('createChatInputOptions', () => {
  it('assigns to interaction.options without a cast', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    interaction.options = createChatInputOptions({ name: 'Alice' })
    expectTypeOf(interaction.options.getString('name')).toEqualTypeOf<string | null>()
  })

  it('is accepted as a construction-time prop', () => {
    expectTypeOf(
      createMockInteraction(ChatInputCommandInteraction, { options: createChatInputOptions({ name: 'Alice' }) }),
    ).toExtend<ChatInputCommandInteraction>()
  })
})

describe('createMock', () => {
  class NotificationService {
    private readonly prefix = '[bot] '

    async notify(message: string): Promise<string> {
      return this.prefix + message
    }
  }

  interface Cache {
    get(key: string): string | null
  }

  // The point of the helper. A class with a private member can never be satisfied
  // by an object literal, so without this every service double needs a cast.
  it('is assignable to the class it mocks', () => {
    expectTypeOf(createMock<NotificationService>()).toExtend<NotificationService>()
  })

  it('is assignable to an interface, which has no runtime class', () => {
    expectTypeOf(createMock<Cache>()).toExtend<Cache>()
  })

  it('keeps the mock API on methods', () => {
    expectTypeOf(createMock<NotificationService>().notify.mockResolvedValue).toBeFunction()
  })

  it('keeps the real call signature on methods', () => {
    expectTypeOf(createMock<Cache>().get('k')).toEqualTypeOf<string | null>()
  })

  it('rejects a prop the type does not declare', () => {
    // @ts-expect-error `notifi` is not a method on NotificationService.
    createMock<NotificationService>({ notifi: async () => '' })
  })
})

describe('DeepMocked depth cap', () => {
  it('stops recursing at the cap and hands back the source type', () => {
    expectTypeOf<DeepMocked<{ a: 1 }, [0, 0, 0, 0, 0]>>().toEqualTypeOf<{ a: 1 }>()
  })
})

describe('createMockMessage', () => {
  it('takes typed overrides, or none', () => {
    expectTypeOf(createMockMessage).parameter(0).toEqualTypeOf<MockMessageOverrides | undefined>()

    createMockMessage()
    createMockMessage({
      id: '123456789012345678',
      content: 'Hello',
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('a').setLabel('A').setStyle(ButtonStyle.Primary),
        ),
        { type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: 'b', label: 'B' }] },
      ],
      embeds: [new EmbedBuilder().setTitle('Card'), { description: 'Plain JSON' }],
      flags: MessageFlags.Ephemeral,
    })
    createMockMessage({ flags: ['IsComponentsV2', 'SuppressNotifications'] })
  })

  it('refuses shapes a message cannot hold', () => {
    // @ts-expect-error a text input belongs in a modal, not a message
    createMockMessage({ components: [{ type: ComponentType.TextInput, custom_id: 'x', style: TextInputStyle.Short, label: 'X' }] })
    // @ts-expect-error an unknown flag name
    createMockMessage({ flags: ['Loud'] })
    // @ts-expect-error content is text
    createMockMessage({ content: 42 })
    // @ts-expect-error an option the mock does not take
    createMockMessage({ author: 'someone' })
  })
})

describe('createMockChannel', () => {
  it('takes a thread channel, whose class discord.js types apart from the Channel union', () => {
    const thread = createMockChannel(ThreadChannel)
    expectTypeOf(thread).toMatchTypeOf<ThreadChannel>()
    expectTypeOf(thread.members.add).toBeFunction()
  })

  it('lets a text channel create a mocked thread, as the mocks guide shows', () => {
    const channel = createMockChannel(TextChannel)
    const thread = createMockChannel(ThreadChannel)
    // discord.js types a created thread as public or private, not as the ThreadChannel class
    channel.threads.create.mockResolvedValue(thread as never)
    expectTypeOf(channel.threads.create).toBeFunction()
  })
})
