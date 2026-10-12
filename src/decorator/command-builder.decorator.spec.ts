import { SlashCommandBuilder } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { CommandBuilder } from '@src/decorator/command-builder.decorator.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { Command, Controller } from '@src/decorator/index.js'
import { MetadataKey } from '@src/enum/index.js'
import { CommandType } from '@src/enum/index.js'
describe('@CommandBuilder', () => {
  it('sets commandType metadata on the class', () => {
    @CommandBuilder(CommandType.SLASH)
    class SlashCmd {
      build() {
        return {} as any
      }
    }

    expect(Reflect.getMetadata(MetadataKey.CommandType, SlashCmd)).toBe(CommandType.SLASH)
  })

  it('sets CONTEXT_MENU commandType', () => {
    @CommandBuilder(CommandType.CONTEXT_MENU)
    class ContextCmd {
      build() {
        return {} as any
      }
    }

    expect(Reflect.getMetadata(MetadataKey.CommandType, ContextCmd)).toBe(CommandType.CONTEXT_MENU)
  })

  it('makes the class inversify-injectable', () => {
    @CommandBuilder(CommandType.SLASH)
    class TestCmd {
      build() {
        return {} as any
      }
    }

    expect(Reflect.getMetadata(MetadataKey.Injectable, TestCmd)).toBe(true)
  })

  it('does not throw when applied to an already-injectable class', () => {
    expect(() => {
      @CommandBuilder(CommandType.SLASH)
      @CommandBuilder(CommandType.SLASH)

      //@ts-ignore
      class _TestCmd {
        build() {
          return {} as any
        }
      }
    }).not.toThrow()
  })

  describe('a subclass of a builder with guilds', () => {
    const build = (name: string) => new SlashCommandBuilder().setName(name).setDescription('A command')

    afterEach(() => {
      vi.restoreAllMocks()
    })

    function staffBuilder() {
      @CommandBuilder(CommandType.SLASH, { guilds: ['111111111111111111'] })
      class StaffBuilder {
        build(name: string) {
          return build(name)
        }
      }
      return StaffBuilder
    }

    it('warns when it gives no guilds, naming both classes, and keeps registering in the base\'s', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
      const StaffBuilder = staffBuilder()

      @CommandBuilder(CommandType.SLASH)
      class EveryoneBuilder extends StaffBuilder {}

      @Controller()
      class Help {
        @Command('help', EveryoneBuilder)
        help() {}
      }

      expect(warn.mock.calls).toEqual([
        [
          "EveryoneBuilder gives no guilds and inherits StaffBuilder's; declare guilds on EveryoneBuilder to keep them. " +
            'The next major version (5.0) registers it in the configured scope.',
        ],
      ])
      expect(getCommandMap(Help.prototype).help?.map(command => command.guilds)).toEqual([['111111111111111111']])
    })

    it('names the class that gives the guilds when it inherits them through another', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
      const StaffBuilder = staffBuilder()

      class ModeratorBuilder extends StaffBuilder {}

      @CommandBuilder(CommandType.SLASH)
      class MuteBuilder extends ModeratorBuilder {}
      void MuteBuilder

      expect(warn.mock.calls.map(([message]) => String(message).split(';')[0])).toEqual([
        "MuteBuilder gives no guilds and inherits StaffBuilder's",
      ])
    })

    it.each([
      ['gives its own guilds', { guilds: ['222222222222222222'] }],
      ['is registered nowhere', { guilds: [] }],
    ])('does not warn when it %s', (_, options) => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
      const StaffBuilder = staffBuilder()

      @CommandBuilder(CommandType.SLASH, options)
      class OwnBuilder extends StaffBuilder {}

      expect([OwnBuilder.name, warn.mock.calls]).toEqual(['OwnBuilder', []])
    })

    it('does not warn for a subclass of a builder without guilds', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})

      @CommandBuilder(CommandType.SLASH)
      class Base {
        build(name: string) {
          return build(name)
        }
      }

      @CommandBuilder(CommandType.SLASH)
      class Sub extends Base {}

      expect([Sub.name, warn.mock.calls]).toEqual(['Sub', []])
    })
  })
})
