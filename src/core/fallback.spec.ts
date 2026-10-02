import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  type APIEmbed,
  Message,
  MessageFlagsBitField,
  ModalSubmitInteraction,
  resolveColor,
  MessageReaction,
} from 'discord.js'
import { vi } from 'vitest'
import {
  CommandNotFoundError,
  CooldownError,
  CooldownStoreError,
  cooldownStoreMessage,
  GuardDeniedError,
  MessageUsageError,
  UserError,
  ValidationError,
} from '@src/common/index.js'
import { Logger } from '@src/common/logger.js'
import { HandlerExecutionContext, UnroutedExecutionContext } from '@src/common/execution-context.js'
import { MessageHandler, On } from '@src/decorator/index.js'
import { createFallback, isUserOutcome } from '@src/core/fallback.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createDiscordError, createMockInteraction, createMockMessage } from '@src/testing/index.js'

const createLogger = () =>
  ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) as unknown as Logger & {
    error: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
  }

const failure = new Error('boom')
const GENERIC = 'An error occurred while executing the command.'
const Ephemeral = MessageFlagsBitField.Flags.Ephemeral

function discordError(code: number) {
  return Object.assign(new Error(`Discord error ${code}`), { code })
}

interface Sent {
  embeds?: APIEmbed[]
  flags?: unknown
}

/** What the first call to a reply method sent. */
function sent(method: { mock: { calls: unknown[][] } }): Sent {
  return method.mock.calls[0][0] as Sent
}

/**
 * The description of the one embed a payload carries, checking it is styled as an error of its tone: `danger` for a
 * fault in the bot, `warning` for the user's own outcome.
 */
function describedAs(payload: Sent, tone: 'danger' | 'warning'): string | undefined {
  const [embed] = payload.embeds ?? []
  expect(embed.color).toBe(resolveColor(DEFAULT_THEME.colors[tone]))
  expect(embed.title).toBe('Oops!')
  return embed.description
}

async function fail(interaction: unknown, error: unknown = failure, logger = createLogger()) {
  await createFallback(logger)(error, new UnroutedExecutionContext([interaction]))
  return logger
}

describe('the fallback', () => {
  // A message sent too often is simply ignored, as the cooldown means; it is not a fault to report.
  it('logs a message blocked by a cooldown at debug level only', async () => {
    const logger = await fail(createMockMessage(), new CooldownError(5_000, 'channel'))

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cooldown (channel)'))
  })

  // The runner logs a failing store once per outage; each call it refused is logged at debug level only
  it('logs a message a failing cooldown store refused at debug level only', async () => {
    const logger = await fail(createMockMessage(), new CooldownStoreError(new Error('down'), false))

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cooldown store down'))
  })

  it('still logs any other error from a message as an error', async () => {
    const logger = await fail(createMockMessage())

    expect(logger.error).toHaveBeenCalled()
  })

  describe('on an unanswered interaction', () => {
    it('replies privately with the generic error text and error styling', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)

      const logger = await fail(interaction)

      const payload = sent(interaction.reply)
      expect(describedAs(payload, 'danger')).toBe(GENERIC)
      expect(payload.flags).toBe(Ephemeral)
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error handling'), failure)
    })

    it('says "Command not found!" for CommandNotFoundError, as a warning', async () => {
      const interaction = createMockInteraction(ButtonInteraction)

      const logger = await fail(interaction, new CommandNotFoundError('No handler matched it.'))

      expect(describedAs(sent(interaction.reply), 'warning')).toBe('Command not found!')
      expect(logger.warn).toHaveBeenCalledWith('No handler matched it.')
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("shows a GuardDeniedError's own message, privately", async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)

      const logger = await fail(interaction, new GuardDeniedError('Owners only.'))

      const payload = sent(interaction.reply)
      expect(describedAs(payload, 'warning')).toBe('Owners only.')
      expect(payload.flags).toBe(Ephemeral)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('tells a caller a failing cooldown store refused, privately, logging it only at debug level', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)

      const logger = await fail(interaction, new CooldownStoreError(undefined, true))

      const payload = sent(interaction.reply)
      expect(describedAs(payload, 'warning')).toBe(cooldownStoreMessage())
      expect(payload.flags).toBe(Ephemeral)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('tells a caller blocked by a cooldown privately how long to wait, logging it only at debug level', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)

      const refusal = new CooldownError(12_000, 'user')
      const logger = await fail(interaction, refusal)

      const payload = sent(interaction.reply)
      expect(describedAs(payload, 'warning')).toBe(`Slow down: try again <t:${Math.ceil(refusal.retryAt.getTime() / 1000)}:R>.`)
      expect(payload.flags).toBe(Ephemeral)
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Cooldown (user)'))
    })

    it("lists a ValidationError's issues privately, logging it only at debug level", async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      const invalid = new ValidationError([
        { message: 'Must be at least 1', path: ['minutes'] },
        { message: 'Too long', path: ['note'] },
      ])

      const logger = await fail(interaction, invalid)

      const payload = sent(interaction.reply)
      expect(describedAs(payload, 'warning')).toBe('minutes: Must be at least 1\nnote: Too long')
      expect(payload.flags).toBe(Ephemeral)
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Invalid input'))
    })
  })

  describe('on a command whose reply was deferred', () => {
    it('edits the deferred reply into the error', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()

      await fail(interaction)

      expect(describedAs(sent(interaction.editReply), 'danger')).toBe(GENERIC)
      expect(interaction.followUp).not.toHaveBeenCalled()
    })

    it('keeps validation issues private on a public deferred command', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()

      await fail(interaction, new ValidationError([{ message: 'Must be at least 1', path: ['minutes'] }]))

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(interaction.deleteReply).toHaveBeenCalled()
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
    })

    it('deletes the deferred reply, then follows up privately, for an error about the caller', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()
      const steps: string[] = []
      interaction.deleteReply.mockImplementation(async () => void steps.push('delete'))
      interaction.followUp.mockImplementation(async () => {
        steps.push('followUp')
        return createMockMessage() as unknown as Message
      })

      await fail(interaction, new GuardDeniedError('Owners only.'))

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(steps).toEqual(['delete', 'followUp'])
      const payload = sent(interaction.followUp)
      expect(describedAs(payload, 'warning')).toBe('Owners only.')
      expect(payload.flags).toBe(Ephemeral)
    })

    it('keeps a CooldownError private on a public deferred command, with the time its wait ends', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()
      const refusal = new CooldownError(12_000, 'user')

      await fail(interaction, refusal)

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(interaction.deleteReply).toHaveBeenCalledTimes(1)
      const payload = sent(interaction.followUp)
      expect(describedAs(payload, 'warning')).toBe(`Slow down: try again <t:${Math.ceil(refusal.retryAt.getTime() / 1000)}:R>.`)
      expect(payload.flags).toBe(Ephemeral)
    })

    it('treats a modal submitted from a command like a command', async () => {
      const interaction = createMockInteraction(ModalSubmitInteraction)
      await interaction.deferReply()

      await fail(interaction)

      expect(interaction.editReply).toHaveBeenCalled()
    })
  })

  describe('on an interaction already answered', () => {
    it('follows up privately after a reply', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.reply({ content: 'working on it' })

      await fail(interaction)

      const payload = sent(interaction.followUp)
      expect(describedAs(payload, 'danger')).toBe(GENERIC)
      expect(payload.flags).toBe(Ephemeral)
    })

    it('never edits the message of a deferred component, following up privately instead', async () => {
      const interaction = createMockInteraction(ButtonInteraction)
      await interaction.deferUpdate()

      await fail(interaction)

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(interaction.deleteReply).not.toHaveBeenCalled()
      expect(sent(interaction.followUp).flags).toBe(Ephemeral)
    })

    it('never edits the message a deferred modal was submitted from', async () => {
      const interaction = createMockInteraction(ModalSubmitInteraction, {
        message: createMockMessage() as unknown as Message,
      })
      interaction.deferred = true

      await fail(interaction)

      expect(interaction.editReply).not.toHaveBeenCalled()
      expect(interaction.followUp).toHaveBeenCalled()
    })
  })

  describe('when delivery fails', () => {
    it('follows up once after 40060, the interaction having been answered elsewhere', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      interaction.reply.mockRejectedValueOnce(discordError(40060))
      interaction.followUp.mockResolvedValue(undefined as never)

      await fail(interaction)

      expect(interaction.followUp).toHaveBeenCalledTimes(1)
    })

    it('logs a delivery Discord refuses at debug level and never throws', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      interaction.reply.mockRejectedValueOnce(createDiscordError(50001))

      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

      await fail(interaction)

      expect(interaction.followUp).not.toHaveBeenCalled()
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('Could not deliver the error reply'))
      expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Could not deliver'), expect.anything())
      debug.mockRestore()
      error.mockRestore()
    })

    it('logs a delivery that fails for any other reason as an error, a fault rather than a refusal', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      const broken = new TypeError('payload.embeds is not iterable')
      interaction.reply.mockRejectedValueOnce(broken)

      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

      await fail(interaction)

      expect(error).toHaveBeenCalledWith('Could not deliver the error reply:', broken)
      error.mockRestore()
    })

    it('never throws when the 40060 retry fails too', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      interaction.reply.mockRejectedValueOnce(discordError(40060))
      interaction.followUp.mockRejectedValueOnce(discordError(10062))

      await expect(fail(interaction)).resolves.toBeDefined()
    })
  })

  it('only logs an expired interaction (10062)', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)

    const logger = await fail(interaction, discordError(10062))

    expect(interaction.reply).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('expired'), expect.anything())
  })

  it('closes an autocomplete menu with an empty list', async () => {
    const interaction = createMockInteraction(AutocompleteInteraction)

    await fail(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
  })

  it('only logs an error from a message handler', async () => {
    const message = createMockMessage()
    Object.assign(message, { content: 'hello' })

    const logger = await fail(message)

    expect(logger.error).toHaveBeenCalledWith('Error handling message "hello":', failure)
    expect(message.reply).not.toHaveBeenCalled()
  })
})

/** A reaction as the fallback reads one: its class and its emoji. */
const mockReaction = () => Object.defineProperty(Object.create(MessageReaction.prototype), 'emoji', { value: { name: '👍' } }) as MessageReaction

describe('the fallback on a message a guard or validation refuses', () => {
  afterEach(() => vi.useRealTimers())

  class Moderation {
    @MessageHandler('ban {target}')
    ban() {}

    @MessageHandler()
    everything() {}

    @On('messageCreate')
    watch() {}
  }
  const contextFor = (methodName: string, message: Message) =>
    new HandlerExecutionContext({ controller: Moderation, methodName, args: [message], type: 'message' })

  it.each([
    ['a guard', () => new GuardDeniedError('Only moderators can ban.'), 'Only moderators can ban.'],
    ['validation', () => new ValidationError([{ message: 'amount: must be at least 1', path: ['amount'] }]), 'amount: must be at least 1'],
  ])('replies to a command with the reason %s gives, without pinging, and deletes the reply as a usage reply', async (_by, makeError, text) => {
    vi.useFakeTimers()
    const message = Object.assign(createMockMessage(), { content: '!ban x' })
    const logger = createLogger()

    await createFallback(logger, () => ({ deleteUsageRepliesAfter: 3 }))(makeError(), contextFor('ban', message))
    const reply = await (vi.mocked(message.reply).mock.results[0]?.value as Promise<{ deleted: boolean }>)

    expect(message.reply).toHaveBeenCalledWith({ content: expect.stringContaining(text), allowedMentions: { repliedUser: false, parse: [] } })
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(reply.deleted).toBe(true)
  })

  it.each(['everything', 'watch'])(
    'answers nothing when a guard refuses a message listener, %s, as its guard filters messages rather than answers a command',
    async methodName => {
      const message = Object.assign(createMockMessage(), { content: 'hello' })
      const logger = createLogger()

      await createFallback(logger)(new GuardDeniedError('Not in this channel.'), contextFor(methodName, message))

      expect(message.reply).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalled()
    },
  )

  // A reaction has no message to answer, so its guard only filters, as a listener's does
  it('logs a guard refusing a reaction at debug level only', async () => {
    const logger = await fail(mockReaction(), new GuardDeniedError('Not for you.'))

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith('Denied reaction "👍": Not for you.')
  })
})

// Pinned against the fallback itself, so a branch added to one and not the other fails here
describe('isUserOutcome', () => {
  const errors: [string, () => unknown][] = [
    ['MessageUsageError', () => new MessageUsageError('!roll <sides>', [])],
    ['a quiet MessageUsageError', () => new MessageUsageError('!roll <sides>', [], { quiet: true })],
    ['CommandNotFoundError', () => new CommandNotFoundError()],
    ['GuardDeniedError', () => new GuardDeniedError('Not for you.')],
    ['CooldownError', () => new CooldownError(5_000, 'user')],
    ['CooldownStoreError', () => new CooldownStoreError(new Error('down'), false)],
    ['UserError', () => new UserError('You cannot do that.')],
    ['ValidationError', () => new ValidationError([{ message: 'bad', path: ['amount'] }])],
    ['a plain Error', () => new Error('boom')],
    ['an expired interaction (10062)', () => discordError(10062)],
  ]
  const calls: [string, () => unknown][] = [
    ['a command', () => createMockInteraction(ChatInputCommandInteraction)],
    ['an autocomplete', () => createMockInteraction(AutocompleteInteraction)],
    ['a message', () => Object.assign(createMockMessage(), { content: '!roll' })],
    ['a reaction', mockReaction],
  ]

  it.each(errors.flatMap(([name, error]) => calls.map(([on, call]) => [name, on, error, call] as const)))(
    'agrees with the fallback about %s on %s',
    async (_name, _on, makeError, makeCall) => {
      const error = makeError()
      const call = makeCall()

      const logger = await fail(call, error)

      // An expired interaction is only warned about, but it is a timing failure, not the user's outcome
      const expired = (error as { code?: unknown }).code === 10062
      expect(isUserOutcome(error, call)).toBe(!expired && logger.error.mock.calls.length === 0)
    },
  )

  it('counts a user error on a command, and a plain error nowhere', () => {
    expect(isUserOutcome(new UserError('no'), createMockInteraction(ChatInputCommandInteraction))).toBe(true)
    expect(isUserOutcome(new Error('boom'), createMockMessage())).toBe(false)
  })
})

