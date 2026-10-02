import { describe, it } from 'vitest'
import { type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type Message, type MessageReaction } from 'discord.js'
import { Autocomplete, Command, Cooldown, Defer, MessageHandler, On, Once, ReactionHandler, UsePipe, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type StandardSchemaV1 } from '@src/interface/index.js'

/**
 * Runs under `vitest --typecheck`. A handler may take fewer parameters than dispatch passes, as any
 * TypeScript callback can; a parameter of the wrong type is still refused.
 */

declare const minutes: StandardSchemaV1<unknown, { minutes: number }>

describe('handler decorators', () => {
  it('accept a handler that takes no parameters', () => {
    class Handlers {
      @Command('zero', CommandType.BUTTON)
      async zero() {
        return undefined
      }

      @Command('zero-slash', CommandType.SLASH)
      @Defer()
      @Cooldown({ seconds: 3 })
      async zeroSlash() {
        return undefined
      }

      @Autocomplete('zero-slash')
      async suggest() {
        return undefined
      }

      @MessageHandler('hi')
      async hi() {
        return undefined
      }

      @ReactionHandler('👍')
      async like() {
        return undefined
      }

      @On('guildMemberAdd')
      async joined() {
        return undefined
      }

      @Once('clientReady')
      async ready() {
        return undefined
      }
    }
    void Handlers
  })

  it('accept a handler that takes only the interaction, message or reaction', () => {
    class Handlers {
      @Command('one', CommandType.BUTTON)
      async one(_interaction: ButtonInteraction) {
        void _interaction
      }

      @MessageHandler('hi')
      async hi(_message: Message) {
        void _message
      }

      @ReactionHandler('👍')
      async like(_reaction: MessageReaction) {
        void _reaction
      }

      @On('guildMemberAdd')
      async joined(_member: GuildMember) {
        void _member
      }
    }
    void Handlers
  })

  it('still refuse a parameter of the wrong type', () => {
    class Handlers {
      // @ts-expect-error a button handler receives a ButtonInteraction
      @Command('wrong', CommandType.BUTTON)
      async wrong(_interaction: ChatInputCommandInteraction) {
        void _interaction
      }

      // @ts-expect-error a message handler receives a Message
      @MessageHandler('wrong')
      async wrongMessage(_message: MessageReaction) {
        void _message
      }

      // @ts-expect-error guildMemberAdd passes a GuildMember
      @On('guildMemberAdd')
      async wrongEvent(_member: string) {
        void _member
      }
    }
    void Handlers
  })

  it('accept a validated or piped handler that ignores its input', () => {
    class Handlers {
      @Command('remind', CommandType.SLASH)
      @Validate(minutes)
      async remind(_interaction: ChatInputCommandInteraction) {
        void _interaction
      }

      @Command('remind-zero', CommandType.SLASH)
      @UsePipe('minutes', { provide: class {} as never })
      async remindZero() {
        return undefined
      }
    }
    void Handlers
  })
})
