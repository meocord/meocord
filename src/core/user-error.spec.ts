import { ChatInputCommandInteraction, type Message, MessageFlagsBitField, MessageReaction } from 'discord.js'
import { vi } from 'vitest'
import { type ExecutionContext, respond, UserError } from '@src/common/index.js'
import { Logger } from '@src/common/logger.js'
import { UnroutedExecutionContext } from '@src/common/execution-context.js'
import { Catch, Command, Controller, Observer, UseFilter } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult, type ExceptionFilter } from '@src/interface/index.js'
import { createFallback } from '@src/core/fallback.js'
import { outcomeOf } from '@src/core/observer-runner.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

const Ephemeral = MessageFlagsBitField.Flags.Ephemeral
const createLogger = () =>
  ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) as unknown as Logger & Record<'error' | 'debug', ReturnType<typeof vi.fn>>
const notEnough = () => new UserError('You need 10 coins.', { code: 'shop.poor', context: { needed: 10, have: 3 } })
const fail = async (subject: unknown, error: unknown, logger = createLogger()) => {
  await createFallback(logger)(error, new UnroutedExecutionContext([subject]))
  return logger
}
const description = (payload: unknown) => (payload as { embeds?: { description?: string }[] }).embeds?.[0]?.description

describe('UserError', () => {
  it('carries its message, code, context and cause', () => {
    const cause = new Error('db said no')
    const error = new UserError('Not found.', { code: 'profile.missing', context: { uid: '8000' }, cause })
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'UserError', message: 'Not found.', code: 'profile.missing', context: { uid: '8000' }, cause })
    expect(new UserError('Plain.')).toMatchObject({ code: undefined, context: undefined })
  })

  describe('the fallback', () => {
    it('shows its message privately, logging it only at debug level', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)

      const logger = await fail(interaction, notEnough())

      const payload = interaction.reply.mock.calls[0][0]
      expect(description(payload)).toBe('You need 10 coins.')
      expect((payload).flags).toBe(Ephemeral)
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalled()
    })

    it('keeps it private on a public deferred command: delete, then follow up', async () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      await interaction.deferReply()

      await fail(interaction, notEnough())

      expect(interaction.deleteReply).toHaveBeenCalled()
      expect(description(interaction.followUp.mock.calls[0][0])).toBe('You need 10 coins.')
    })

    it('replies to a message with it, pinging no one it mentions, and logs it only at debug level', async () => {
      const message = createMockMessage({ content: '!give <@200000000000000001>' })
      const text = '<@200000000000000001>, <@&300000000000000001> and @everyone already have one.'

      const logger = await fail(message, new UserError(text))

      expect(message.reply).toHaveBeenCalledWith({ content: text, allowedMentions: { repliedUser: false, parse: [] } })
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('only logs it, at debug level, for a reaction', async () => {
      const logger = await fail(createMockInteraction(MessageReaction), notEnough())

      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalled()
    })

    it('never throws when the reply to a message fails', async () => {
      const message = createMockMessage({ content: '!buy sword' })
      ;(message.reply as unknown as { mockRejectedValue: (e: unknown) => void }).mockRejectedValue(new Error('Missing Permissions'))

      await expect(fail(message, notEnough())).resolves.toBeDefined()
    })
  })

  it('is what respond().error() shows by default, privately', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    await interaction.deferReply()

    await respond(interaction).error(notEnough())

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferReply', 'deleteReply', 'followUp'])
    expect(description(interaction.followUp.mock.calls[0][0])).toBe('You need 10 coins.')
  })

  it("is reported to observers as 'refused', handled", () => {
    expect(outcomeOf(notEnough())).toBe('refused')
  })

  it('reaches filters with its code and context, and observers with its outcome', async () => {
    const seen: unknown[] = []
    const told: Partial<DispatchResult>[] = []

    @Catch(UserError)
    class Localised implements ExceptionFilter<UserError> {
      async catch(error: UserError, context: ExecutionContext) {
        seen.push([error.code, error.context])
        await context.response?.error(error, { message: `Tu as besoin de ${String(error.context?.needed)} pièces.` })
      }
    }

    @Observer()
    class Audit implements DispatchObserver {
      onSettled(_context: ExecutionContext, { outcome, handled }: DispatchResult) {
        told.push({ outcome, handled })
      }
    }

    @Controller()
    @UseFilter(Localised)
    class Shop {
      @Command('buy', CommandType.SLASH)
      async buy(_interaction: ChatInputCommandInteraction) {
        throw notEnough()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Shop], observers: [Audit] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })

    await module.invoke(Shop, 'buy', interaction)

    expect(seen).toEqual([['shop.poor', { needed: 10, have: 3 }]])
    expect(description(interaction.reply.mock.calls[0][0])).toBe('Tu as besoin de 10 pièces.')
    expect(told).toEqual([{ outcome: 'refused', handled: true }])
  })
})

void (null as unknown as Message)
