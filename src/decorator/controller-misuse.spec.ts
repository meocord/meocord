import { vi } from 'vitest'
import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, type Message, ModalSubmitInteraction, SlashCommandBuilder } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { Command, CommandBuilder, Controller, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CommandBuilderBase } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'
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

  it('says what it was given when that is no interaction at all', () => {
    expect(() => handle(undefined)).toThrow("Cards.card: @Command('card/{id}', CommandType.BUTTON) takes a ButtonInteraction; it was given undefined.")
    expect(() => handle('card/1')).toThrow('takes a ButtonInteraction; it was given "card/1".')
    expect(() => handle({ customId: 'card/1' })).toThrow('takes a ButtonInteraction; it was given an object.')
  })

  it('names the builder a command was declared with, as it was written', () => {
    @CommandBuilder(CommandType.SLASH)
    class StatsBuilder implements CommandBuilderBase {
      build(name: string) {
        return new SlashCommandBuilder().setName(name).setDescription('Stats')
      }
    }
    class Stats {
      @Command('stats', StatsBuilder)
      stats() {}
    }

    expect(() => (new Stats().stats as (interaction: unknown) => void)(createMockInteraction(ButtonInteraction))).toThrow(
      "Stats.stats: @Command('stats', StatsBuilder) takes a ChatInputCommandInteraction, not a ButtonInteraction.",
    )
  })

  // One method may answer routes of several interaction types: each runs it with its own interaction
  describe('on a method with @Commands of two interaction types', () => {
    class Stats {
      ran: string[] = []

      @Command('stats', CommandType.SLASH)
      @Command('stats/refresh', CommandType.BUTTON)
      stats(interaction: ChatInputCommandInteraction | ButtonInteraction) {
        this.ran.push(interaction.constructor.name)
      }
    }

    it('runs it with an interaction of either', () => {
      const stats = new Stats()

      stats.stats(createMockInteraction(ChatInputCommandInteraction))
      stats.stats(createMockInteraction(ButtonInteraction))

      expect(stats.ran).toEqual(['ChatInputCommandInteraction', 'ButtonInteraction'])
    })

    it('is dispatched each of its routes, as the bot dispatches them', async () => {
      const heard: string[] = []
      @Controller()
      class Routed {
        @Command('stats', CommandType.SLASH)
        @Command('stats/refresh', CommandType.BUTTON)
        stats(interaction: ChatInputCommandInteraction | ButtonInteraction) {
          heard.push(interaction.constructor.name)
        }
      }
      const module = MeoCordTestingModule.create({ controllers: [Routed] }).compile()

      await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'stats' }))
      await module.dispatch(createMockInteraction(ButtonInteraction, { customId: 'stats/refresh' }))

      expect(heard).toEqual(['ChatInputCommandInteraction', 'ButtonInteraction'])
    })

    it('refuses an interaction of neither, naming both', () => {
      expect(() => (new Stats().stats as (interaction: unknown) => void)(createMockInteraction(ModalSubmitInteraction))).toThrow(
        'Stats.stats: its @Command routes take a ButtonInteraction or a ChatInputCommandInteraction, not a ModalSubmitInteraction.',
      )
    })
  })

  it('puts the article a class name takes before it, and names an unknown type an interaction', () => {
    class Odd {
      @Command('odd', 'NOT_A_TYPE' as CommandType)
      odd() {}
    }

    expect(() => handle(createMockInteraction(AutocompleteInteraction))).toThrow('takes a ButtonInteraction, not an AutocompleteInteraction.')
    expect(() => (new Odd().odd as (interaction: unknown) => void)(undefined)).toThrow(
      "Odd.odd: @Command('odd', CommandType.NOT_A_TYPE) takes an interaction; it was given undefined.",
    )
  })
})

describe("@MessageHandler('')", () => {
  it('warns once, naming the handler', () => {
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

  it('is dispatched every message, as @MessageHandler() is', async () => {
    const heard: string[] = []
    @Controller()
    class Listen {
      @MessageHandler('')
      empty(message: Message) {
        heard.push(`'' ${message.content}`)
      }

      @MessageHandler()
      none(message: Message) {
        heard.push(`() ${message.content}`)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Listen] }).compile()

    await module.dispatch(createMockMessage({ content: 'hello there' }))

    expect(heard.sort()).toEqual(["'' hello there", '() hello there'])
  })
})

// Spaces alone are no word either, so they read as no pattern, as '' does
describe("@MessageHandler('   ')", () => {
  it('warns, naming the handler, and is dispatched every message, as @MessageHandler() is', async () => {
    const heard: string[] = []
    @Controller()
    class Listen {
      @MessageHandler('   ')
      blank(message: Message) {
        heard.push(message.content)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Listen] }).compile()

    await module.dispatch(createMockMessage({ content: 'hello there' }))

    expect([warnings(), heard]).toEqual([
      ["@MessageHandler('   ') on Listen.blank is deprecated; in the next major version (5.0) it is refused. Use @MessageHandler() instead."],
      ['hello there'],
    ])
  })
})
