import { vi } from 'vitest'
import { ButtonInteraction, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { Command, CommandBuilder, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CommandBuilderBase } from '@src/interface/index.js'
import { createMockInteraction } from '@src/testing/index.js'
import { isRefusal } from '@src/util/refusal.util.js'

const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a command builder whose constructor throws', () => {
  it('is refused as the class loads, naming the handler, the builder and the command, with the error as cause', () => {
    // Its own full stop is dropped, as the refusal ends with one
    const missing = new Error('missing translator.')

    @CommandBuilder(CommandType.SLASH)
    class StatsBuilder implements CommandBuilderBase {
      private readonly description: string = (() => {
        throw missing
      })()
      build(name: string) {
        return new SlashCommandBuilder().setName(name).setDescription(this.description)
      }
    }

    let thrown: unknown
    try {
      class Stats {
        @Command('stats', StatsBuilder)
        stats() {}
      }
      void Stats
    } catch (error) {
      thrown = error
    }

    expect(isRefusal(thrown)).toBe(true)
    expect((thrown as Error).message).toBe('Stats.stats: StatsBuilder could not be made for "stats": missing translator.')
    expect((thrown as Error).cause).toBe(missing)
  })
})

describe('a command builder whose build() throws an error ending in a full stop', () => {
  it('is refused with one full stop after it', () => {
    @CommandBuilder(CommandType.SLASH)
    class BadBuilder implements CommandBuilderBase {
      build(): never {
        throw new Error('Invalid name.')
      }
    }

    expect(() => {
      class Shop {
        @Command('buy', BadBuilder)
        buy() {}
      }
      void Shop
    }).toThrow('Shop.buy: BadBuilder could not build "buy": Invalid name. Check its names')
  })
})

describe('a @Command handler called with another kind of interaction', () => {
  class Cards {
    @Command('card/{id}', CommandType.BUTTON)
    card() {}
  }

  // As dispatch calls a handler: with the interaction it routed, whatever the method declares
  const handle = (interaction: unknown) => (new Cards().card as (interaction: unknown) => void)(interaction)

  it('names the handler, its route and type, the interaction it takes and the one it got', () => {
    const call = () => handle(createMockInteraction(ChatInputCommandInteraction))

    expect(call).toThrow(
      "Cards.card: @Command('card/{id}', CommandType.BUTTON) takes a ButtonInteraction, not a ChatInputCommandInteraction.",
    )
  })

  it('says what it was given when that is no interaction at all', () => {
    expect(() => handle(undefined)).toThrow("Cards.card: @Command('card/{id}', CommandType.BUTTON) takes a ButtonInteraction; it was given undefined.")
    expect(() => handle('card/1')).toThrow('takes a ButtonInteraction; it was given a string.')
    expect(() => handle({ customId: 'card/1' })).toThrow('takes a ButtonInteraction; it was given an object.')
  })

  it('still runs for the interaction it takes', () => {
    expect(() => handle(createMockInteraction(ButtonInteraction))).not.toThrow()
  })
})

describe("@MessageHandler('')", () => {
  it('runs for every message, as @MessageHandler() does, and warns once, naming the handler', () => {
    class Chat {
      @MessageHandler('')
      every() {}

      @MessageHandler()
      all() {}
    }
    void Chat

    expect(warnings()).toEqual([
      "@MessageHandler('') on Chat.every is deprecated; in the next major version (5.0) it is refused. Use " +
        '@MessageHandler() instead.',
    ])
  })
})
