import { describe, it } from 'vitest'
import {
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageReaction,
} from 'discord.js'
import { Autocomplete, Command, MessageHandler, ReactionHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'

/**
 * Runs under `vitest --typecheck`. A handler may return what it awaits, as `return interaction.reply(…)` does,
 * whatever its type: an interceptor receives it from `next.handle()`, and nothing else reads it.
 */
describe('a handler that returns a value', () => {
  it('compiles for every handler decorator, sync or async, with each arity', () => {
    class Handlers {
      @MessageHandler()
      async every(message: Message) {
        return message.id
      }

      @MessageHandler('pong')
      async pong(message: Message) {
        return message.reply('pong')
      }

      @MessageHandler('roll {sides:int}')
      roll(_message: Message, { sides }: { sides: number }) {
        return sides
      }

      @Command('help', CommandType.SLASH)
      async help(interaction: ChatInputCommandInteraction) {
        return interaction.reply('help')
      }

      @Command('stats/{id}', CommandType.BUTTON)
      async stats(interaction: ButtonInteraction, { id }: { id: string }) {
        return interaction.update(id)
      }

      @Command('ping', CommandType.SLASH)
      ping() {
        return true
      }

      @ReactionHandler('👍')
      async thumbs(reaction: MessageReaction) {
        return reaction.fetch()
      }

      @ReactionHandler()
      count() {
        return 1
      }

      @Autocomplete('search', 'query')
      async complete(interaction: AutocompleteInteraction) {
        return interaction.respond([])
      }

      @Autocomplete('search')
      completeAll() {
        return []
      }
    }
    void Handlers
  })

  it('compiles @Autocomplete with the type argument 4.0 took', () => {
    class Handlers {
      @Autocomplete<void>('search', 'query')
      async complete(interaction: AutocompleteInteraction) {
        await interaction.respond([])
      }

      @Autocomplete<Promise<void>>('search')
      async completeAll(interaction: AutocompleteInteraction) {
        return interaction.respond([])
      }
    }
    void Handlers
  })

  it('still refuses a handler whose parameter is of the wrong type', () => {
    class Handlers {
      // @ts-expect-error a slash command's handler takes its interaction, not a message
      @Command('help', CommandType.SLASH)
      async help(message: Message) {
        return message.id
      }
    }
    void Handlers
  })
})
