import { vi } from 'vitest'

// Logger is constructed with `new`, so the implementation has to be a class or
// function — vitest 4 refuses to construct an arrow.
vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = vi.fn()
      error = vi.fn()
      warn = vi.fn()
      debug = vi.fn()
      info = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

const { mockLoadConfig } = vi.hoisted(() => ({ mockLoadConfig: vi.fn() }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: mockLoadConfig }))

import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  MentionableSelectMenuInteraction,
  MessageFlags,
  MessageReaction,
  ModalSubmitInteraction,
  PrimaryEntryPointCommandInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  User,
  UserSelectMenuInteraction,
} from 'discord.js'
import { Logger } from '@src/common/index.js'
import { createChatInputOptions, createMockInteraction, createModalFields, resolveRoute } from '@src/testing/index.js'
import { Autocomplete, Command, Controller, MeoCord, MessageHandler, ReactionHandler, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordApp, shutdownAndExit } from '@src/core/meocord.app.js'
import { DEV_RUNNER_ENV, DEV_RUNNER_SEND_TIMEOUT_MS } from '@src/util/dev-runner.util.js'
import { isRefusal } from '@src/util/refusal.util.js'

/** The text of the error embed the first call to a reply method sent. */
function errorShown(method: { mock: { calls: unknown[][] } }): string | undefined {
  return (method.mock.calls[0]?.[0] as { embeds?: { description?: string }[] } | undefined)?.embeds?.[0]?.description
}
import { type StandardSchemaV1 } from '@src/interface/index.js'

function createMockClient() {
  const listeners = new Map<string, ((...args: any[]) => any)[]>()

  return {
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event)!.push(handler)
    }),
    login: vi.fn<() => Promise<string>>().mockResolvedValue('token'),
    destroy: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    removeAllListeners: vi.fn(),
    user: { setActivity: vi.fn() },
    application: null,
    emit(event: string, ...args: any[]) {
      listeners.get(event)?.forEach(h => h(...args))
    },
    // `emit` deliberately drops the returned promise, the way an EventEmitter does.
    // Awaiting a listener directly is what proves it settles rather than rejecting
    // into nothing.
    listenersFor(event: string) {
      return listeners.get(event) ?? []
    },
  }
}

function createMockContainer(instanceMap = new Map<any, any>()) {
  return {
    get: vi.fn((cls: any) => instanceMap.get(cls) ?? new cls()),
    isBound: vi.fn().mockReturnValue(false),
  }
}

describe('MeoCordApp', () => {
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('registers all required Discord event listeners', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')
      await app.start()

      const registeredEvents = (mockClient.on.mock.calls as [string, any][]).map(([event]) => event)
      expect(registeredEvents).toContain('clientReady')
      expect(registeredEvents).toContain('interactionCreate')
      expect(registeredEvents).toContain('messageCreate')
      expect(registeredEvents).toContain('messageReactionAdd')
      expect(registeredEvents).toContain('messageReactionRemove')
    })

    it('calls bot.login with the provided token', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'my-secret-token')
      await app.start()
      expect(mockClient.login).toHaveBeenCalledWith('my-secret-token')
    })

    // A bot that never came online is a failed start. Swallowing the error would let the entry point
    // report the bot as started and the process exit 0 -- a clean exit to anything supervising it.
    describe('when the login fails', () => {
      const originalExitCode = process.exitCode

      afterEach(() => {
        process.exitCode = originalExitCode
      })

      it('rejects, without reporting the bot online', async () => {
        const error = Object.assign(new Error('An invalid token was provided.'), { code: 'TokenInvalid' })
        mockClient.login.mockRejectedValueOnce(error)
        const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'bad-token')

        await expect(app.start()).rejects.toBe(error)
        expect((app as any).logger.log).not.toHaveBeenCalledWith('Bot is online!')
      })

      // An entry point that catches the rejection to log it has handled it, so without this the
      // process would still end with 0, and every entry point would need to set the code itself.
      it('sets the exit code to 1, so an entry point that catches the error still exits non-zero', async () => {
        mockClient.login.mockRejectedValueOnce(new Error('An invalid token was provided.'))
        const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'bad-token')

        await app.start().catch(() => {})

        expect(process.exitCode).toBe(1)
      })

      // An entry point may retry. Once a retry is online the bot is running fine, and a process that
      // later ends on its own must not report the first attempt's failure.
      it('clears the exit code again when a retry logs in', async () => {
        mockClient.login.mockRejectedValueOnce(new Error('Discord unreachable'))
        const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')

        await app.start().catch(() => {})
        expect(process.exitCode).toBe(1)
        await app.start()

        // 0 rather than undefined, which Bun ignores
        expect(process.exitCode).toBe(0)
      })

      // A code the application set for its own reasons is the application's to keep.
      it('neither overrides nor clears an exit code the application set', async () => {
        process.exitCode = 3
        mockClient.login.mockRejectedValueOnce(new Error('Discord unreachable'))
        const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')

        await app.start().catch(() => {})
        expect(process.exitCode).toBe(3)
        await app.start()

        expect(process.exitCode).toBe(3)
      })

      // `meocord start --dev` ends its watch session on this: a code change cannot fix a login Discord refused
      describe('under meocord start --dev', () => {
        const originalSend = process.send
        const send = vi.fn((_message: unknown, _handle: unknown, _options: unknown, callback?: () => void) => {
          callback?.()
          return true
        })

        beforeEach(() => {
          process.env[DEV_RUNNER_ENV] = '1'
          process.send = send as unknown as typeof process.send
        })

        afterEach(() => {
          delete process.env[DEV_RUNNER_ENV]
          process.send = originalSend
          send.mockClear()
        })

        it('tells the dev runner the bot could not log in', async () => {
          mockClient.login.mockRejectedValueOnce(new Error('An invalid token was provided.'))
          const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'bad-token')

          await app.start().catch(() => {})

          expect(send).toHaveBeenCalledWith({ meocord: 'login-failed' }, undefined, {}, expect.any(Function))
        })

        it('tells it the bot is online when a retry logs in', async () => {
          mockClient.login.mockRejectedValueOnce(new Error('Discord unreachable'))
          const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')

          await app.start().catch(() => {})
          await app.start()

          expect(send.mock.calls.map(([message]) => message)).toEqual([{ meocord: 'login-failed' }, { meocord: 'online' }])
        })

        // Bun does not call back once the dev runner is gone
        it('still rejects when the message to the dev runner never calls back', async () => {
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
          send.mockImplementationOnce(() => true)
          mockClient.login.mockRejectedValueOnce(new Error('An invalid token was provided.'))
          const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'bad-token')

          const started = app.start()
          const rejected = expect(started).rejects.toThrow('An invalid token was provided.')
          await vi.advanceTimersByTimeAsync(DEV_RUNNER_SEND_TIMEOUT_MS)
          await rejected
          expect(process.exitCode).toBe(1)
          vi.useRealTimers()
        })

        it('tells a process the dev runner did not start nothing', async () => {
          delete process.env[DEV_RUNNER_ENV]
          mockClient.login.mockRejectedValueOnce(new Error('An invalid token was provided.'))
          const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'bad-token')

          await app.start().catch(() => {})

          expect(send).not.toHaveBeenCalled()
        })
      })

      it('leaves the exit code alone when the login succeeds', async () => {
        const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')

        await app.start()

        expect(process.exitCode).toBe(originalExitCode)
      })
    })

    it('starts an activity interval on clientReady', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token', [{ name: 'Playing' }])
      await app.start()

      mockClient.emit('clientReady')

      expect(mockClient.user.setActivity).not.toHaveBeenCalled()
      vi.advanceTimersByTime(10000)
      expect(mockClient.user.setActivity).toHaveBeenCalled()
    })
  })

  describe('handleMessage()', () => {
    it('ignores messages from bots', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')
      await app.start()

      mockClient.emit('messageCreate', {
        author: { bot: true },
        content: 'hello',
      })

      // No controllers — just verifying no crash
      expect(mockClient.login).toHaveBeenCalled()
    })

    it('ignores messages with empty content', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')
      await app.start()

      mockClient.emit('messageCreate', {
        author: { bot: false },
        content: '   ',
      })

      expect(mockClient.login).toHaveBeenCalled()
    })
  })

  describe('handleReaction()', () => {
    const BOT_ID = 'bot-1'
    const users = {
      own: { id: BOT_ID, bot: true },
      otherBot: { id: 'bot-2', bot: true },
      person: { id: 'user-1', bot: false },
    }
    const reactionTo = (name: string) => ({ emoji: { name }, message: { fetch: vi.fn<() => Promise<void>>().mockResolvedValue() } })

    async function startWith(controller: new () => unknown) {
      const app = new MeoCordApp([controller] as any, createMockContainer() as any, mockClient as any, 't')
      Object.assign(mockClient.user, { id: BOT_ID })
      await app.start()
      return mockClient.listenersFor('messageReactionAdd')[0]
    }

    it("ignores the bot's own reactions and other bots', and runs for a user's", async () => {
      const calls: string[] = []

      @Controller()
      class PollController {
        @ReactionHandler('👍')
        async vote(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`vote ${user.id}`)
        }

        @ReactionHandler()
        async any(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`any ${user.id}`)
        }
      }

      const listener = await startWith(PollController)
      const own = reactionTo('👍')
      await listener(own, users.own)
      await listener(reactionTo('👍'), users.otherBot)
      await listener(reactionTo('👍'), users.person)

      expect(calls).toEqual(['vote user-1', 'any user-1'])
      // A reaction no handler takes does not fetch its message
      expect(own.message.fetch).not.toHaveBeenCalled()
    })

    it('runs a handler that opts in with { bots: true } for bot reactions, its own included', async () => {
      const calls: string[] = []

      @Controller()
      class RelayController {
        @ReactionHandler('📌', { bots: true })
        async pin(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`pin ${user.id}`)
        }

        @ReactionHandler({ bots: true })
        async any(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`any ${user.id}`)
        }

        @ReactionHandler('📌')
        async people(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`people ${user.id}`)
        }
      }

      const listener = await startWith(RelayController)
      await listener(reactionTo('📌'), users.own)
      await listener(reactionTo('📌'), users.otherBot)
      await listener(reactionTo('📌'), users.person)

      expect(calls).toEqual([
        `pin ${BOT_ID}`,
        `any ${BOT_ID}`,
        'pin bot-2',
        'any bot-2',
        'pin user-1',
        'people user-1',
        'any user-1',
      ])
    })

    // Two servers can each have a custom emoji called party; only its id tells them apart
    it('matches a custom emoji by its id, or the <:name:id> Discord shows, as well as by name', async () => {
      const calls: string[] = []

      @Controller()
      class PartyController {
        @ReactionHandler('111')
        async byId() {
          calls.push('by id')
        }

        @ReactionHandler('<a:party:111>')
        async byMention() {
          calls.push('by mention')
        }

        @ReactionHandler('party')
        async byName() {
          calls.push('by name')
        }
      }

      const listener = await startWith(PartyController)
      const custom = (id: string, name: string) => ({ ...reactionTo(name), emoji: { id, name } })
      await listener(custom('111', 'party'), users.person)
      await listener(custom('222', 'party'), users.person)

      expect(calls).toEqual(['by id', 'by mention', 'by name', 'by name'])
    })

    it('fetches a partial user to tell whether it is a bot, and skips it when that fails', async () => {
      const calls: string[] = []

      @Controller()
      class PollController {
        @ReactionHandler('👍')
        async vote(_reaction: MessageReaction, { user }: { user: { id: string } }) {
          calls.push(`vote ${user.id}`)
        }
      }

      const listener = await startWith(PollController)
      const partial = (id: string, fetched: Promise<{ bot: boolean }>) => ({ id, bot: null, partial: true, fetch: vi.fn(() => fetched) })
      const partialBot = partial('bot-2', Promise.resolve({ bot: true }))
      const partialPerson = partial('user-2', Promise.resolve({ bot: false }))
      const unknown = partial('user-3', Promise.reject(new Error('Unknown User')))
      await listener(reactionTo('👍'), partialBot)
      await listener(reactionTo('👍'), partialPerson)
      await listener(reactionTo('👍'), unknown)

      expect(partialBot.fetch).toHaveBeenCalled()
      expect(calls).toEqual(['vote user-2'])
      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).not.toHaveBeenCalled()
    })
  })

  // A control that is emitted but never routed -- a customId whose value broke its
  // pattern, or a handler nobody wrote -- has to be visible: the user sees
  // "Command not found!", and the log names the id that failed to match.
  describe('unmatched interactions', () => {
    const unmatchedButton = () => {
      const interaction = createMockInteraction(ButtonInteraction)
      interaction.customId = 'pw-delete-account-999-role-2'
      return interaction
    }

    it('logs the customId that matched no handler', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')
      await app.start()

      mockClient.emit('interactionCreate', unmatchedButton())
      await vi.advanceTimersByTimeAsync(0)

      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('pw-delete-account-999-role-2'))
    })

    it('names the @Command pattern as the thing to check', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token')
      await app.start()

      mockClient.emit('interactionCreate', unmatchedButton())
      await vi.advanceTimersByTimeAsync(0)

      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('@Command'))
    })
  })

  // A parameter matches anything, so a broad route can also match an id that a more
  // literal sibling owns. Which one wins must come from the patterns themselves --
  // relying on registration order would make it depend on file layout.
  describe('overlapping routes', () => {
    const press = (customId: string) => {
      const interaction = createMockInteraction(ButtonInteraction)
      interaction.customId = customId
      return interaction
    }

    const controllers = () => {
      const calls: { handler: string; params: Record<string, string> }[] = []

      @Controller()
      class BroadController {
        @Command('gi-profile/{uuid}/{uid}', CommandType.BUTTON)
        async broad(_i: unknown, params: Record<string, string>) {
          calls.push({ handler: 'broad', params })
        }
      }

      @Controller()
      class SpecificController {
        @Command('gi-profile/summary/{ownerId}/{uid}', CommandType.BUTTON)
        async specific(_i: unknown, params: Record<string, string>) {
          calls.push({ handler: 'specific', params })
        }
      }

      return { BroadController, SpecificController, calls }
    }

    it('gives an id to the route that spells more of it out, however they were declared', async () => {
      for (const broadFirst of [true, false]) {
        const { BroadController, SpecificController, calls } = controllers()
        const order = broadFirst ? [BroadController, SpecificController] : [SpecificController, BroadController]
        const app = new MeoCordApp(order as any, createMockContainer() as any, mockClient as any, 'token')
        await app.start()

        mockClient.emit('interactionCreate', press('gi-profile/summary/123/456'))
        await vi.advanceTimersByTimeAsync(0)

        expect(calls).toEqual([{ handler: 'specific', params: { ownerId: '123', uid: '456' } }])
        mockClient = createMockClient()
      }
    })

    // resolveRoute is the public answer to "which handler does this id reach"; it has to be dispatch's.
    it('agrees with resolveRoute on which handler an id reaches', async () => {
      const { BroadController, SpecificController, calls } = controllers()
      @MeoCord({ controllers: [BroadController, SpecificController], clientOptions: { intents: [] } })
      class App {}
      const app = new MeoCordApp(
        [BroadController, SpecificController] as any,
        createMockContainer() as any,
        mockClient as any,
        'token',
      )
      await app.start()

      for (const customId of ['gi-profile/summary/123/456', 'gi-profile/abc-def/789']) {
        calls.length = 0
        mockClient.emit('interactionCreate', press(customId))
        await vi.advanceTimersByTimeAsync(0)

        const route = resolveRoute(App, { type: CommandType.BUTTON, customId })
        expect(calls).toEqual([{ handler: route?.method, params: route?.params }])
      }
    })

    it('still routes an id only the broad pattern can take', async () => {
      const { BroadController, SpecificController, calls } = controllers()
      const app = new MeoCordApp(
        [SpecificController, BroadController] as any,
        createMockContainer() as any,
        mockClient as any,
        'token',
      )
      await app.start()

      mockClient.emit('interactionCreate', press('gi-profile/asjhdasf-asdaf123-sdfasd-xxxx/800000001'))
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual([{ handler: 'broad', params: { uuid: 'asjhdasf-asdaf123-sdfasd-xxxx', uid: '800000001' } }])
    })
  })

  // `a/{x}/c` and `a/b/{y}` both take `a/b/c`, and neither is more literal than the
  // other, so ranking cannot settle it. Saying so at startup beats letting one of
  // them quietly win every click.
  describe('ambiguous routes', () => {
    it('warns about a pair that trades a literal for a parameter in each direction', async () => {
      @Controller()
      class AmbiguousController {
        @Command('a/{x}/c', CommandType.BUTTON)
        async one(..._args: any[]) {}

        @Command('a/b/{y}', CommandType.BUTTON)
        async two(..._args: any[]) {}
      }

      const app = new MeoCordApp([AmbiguousController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      // Before any interaction arrives
      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('can match the same customId'))

      // Built once: the first click reuses the routes and does not warn again
      mockClient.emit('interactionCreate', createMockInteraction(ButtonInteraction))
      await vi.advanceTimersByTimeAsync(0)
      expect(warn.mock.calls.filter(([message]: [string]) => message.includes('can match the same customId'))).toHaveLength(1)
    })

    it('refuses the app as it is created, before start() attaches anything, when two handlers have the same pattern', () => {
      @Controller()
      class Profile {
        @Command('profile/{uid}', CommandType.BUTTON)
        async show(..._args: any[]) {}
      }
      @Controller()
      class Card {
        @Command('profile/{id}', CommandType.BUTTON)
        async open(..._args: any[]) {}
      }

      let thrown: unknown
      try {
        new MeoCordApp([Profile, Card] as any, createMockContainer() as any, mockClient as any, 't')
      } catch (error) {
        thrown = error
      }
      expect((thrown as Error).message).toMatch(/^Profile\.show: "profile\/\{uid\}" and "profile\/\{id\}" in Card\.open match the same button customIds/)
      expect(isRefusal(thrown)).toBe(true)
      expect(mockClient.on).not.toHaveBeenCalled()
      expect(mockClient.login).not.toHaveBeenCalled()
    })

    it('stays quiet when the patterns cannot collide', async () => {
      @Controller()
      class DistinctController {
        @Command('profile/{uuid}', CommandType.BUTTON)
        async one(..._args: any[]) {}

        @Command('profile/{uuid}/{id}', CommandType.BUTTON)
        async two(..._args: any[]) {}
      }

      const app = new MeoCordApp([DistinctController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', createMockInteraction(ButtonInteraction))
      await vi.advanceTimersByTimeAsync(0)

      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('can match the same customId'))
    })
  })

  // Discord sends the four entity select menus as distinct component types carrying
  // different resolved data. Routing them all as "a select menu" -- or not at all --
  // answered a working component with "Command not found!".
  describe('component dispatch', () => {
    const componentCases: [CommandType, { prototype: any; name: string }][] = [
      [CommandType.SELECT_MENU, StringSelectMenuInteraction],
      [CommandType.USER_SELECT_MENU, UserSelectMenuInteraction],
      [CommandType.ROLE_SELECT_MENU, RoleSelectMenuInteraction],
      [CommandType.MENTIONABLE_SELECT_MENU, MentionableSelectMenuInteraction],
      [CommandType.CHANNEL_SELECT_MENU, ChannelSelectMenuInteraction],
    ]

    it.each(componentCases)('routes %s to its handler with the pattern params', async (type, InteractionClass) => {
      const calls: Record<string, string>[] = []

      @Controller()
      class SelectController {
        @Command('pick/{scope}', type)
        async handle(_interaction: unknown, params: Record<string, string>) {
          calls.push(params)
        }
      }

      const app = new MeoCordApp([SelectController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = createMockInteraction(InteractionClass, { customId: 'pick/guild' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      // A select menu's choices come too; this pins only the route's params
      expect(calls).toEqual([expect.objectContaining({ scope: 'guild' })])
    })

    // A button and a select menu may legitimately share a customId shape. Matching on
    // the pattern alone would let whichever ranked first swallow the other's clicks.
    it('tells two components apart when they share a pattern', async () => {
      const calls: string[] = []

      @Controller()
      class SharedController {
        @Command('shared/{id}', CommandType.BUTTON)
        async button(..._args: any[]) {
          calls.push('button')
        }

        @Command('shared/{id}', CommandType.CHANNEL_SELECT_MENU)
        async select(..._args: any[]) {
          calls.push('select')
        }
      }

      const app = new MeoCordApp([SharedController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit(
        'interactionCreate',
        createMockInteraction(ChannelSelectMenuInteraction, { customId: 'shared/7' }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual(['select'])
    })

    it('does not warn about an overlap between two different component types', async () => {
      @Controller()
      class SharedController {
        @Command('shared/{id}', CommandType.BUTTON)
        async button(..._args: any[]) {}

        @Command('shared/{id}', CommandType.SELECT_MENU)
        async select(..._args: any[]) {}
      }

      const app = new MeoCordApp([SharedController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', createMockInteraction(ButtonInteraction, { customId: 'shared/7' }))
      await vi.advanceTimersByTimeAsync(0)

      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('can match the same customId'))
    })
  })

  // Discord sends `/settings notify email` as one interaction named `settings`, so a
  // command whose subcommands live in separate methods has to be dispatched by its
  // subcommand path, not by whichever method was declared first.
  describe('slash command dispatch', () => {
    const invoke = (commandName: string, options: Parameters<typeof createChatInputOptions>[0] = {}) => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
      interaction.options = createChatInputOptions(options)
      return interaction
    }

    const controllers = () => {
      const calls: { handler: string; params: Record<string, unknown> }[] = []

      @Controller()
      class ParentController {
        @Command('settings', CommandType.SLASH)
        async parent(_i: unknown, params: Record<string, unknown>) {
          calls.push({ handler: 'parent', params })
        }
      }

      @Controller()
      class SubController {
        @Command('settings notify email', CommandType.SLASH)
        async sub(_i: unknown, params: Record<string, unknown>) {
          calls.push({ handler: 'sub', params })
        }
      }

      return { ParentController, SubController, calls }
    }

    it('gives a subcommand to its own handler, however the controllers were registered', async () => {
      for (const parentFirst of [true, false]) {
        const { ParentController, SubController, calls } = controllers()
        const order = parentFirst ? [ParentController, SubController] : [SubController, ParentController]
        const app = new MeoCordApp(order as any, createMockContainer() as any, mockClient as any, 't')
        await app.start()

        mockClient.emit(
          'interactionCreate',
          invoke('settings', { subcommandGroup: 'notify', subcommand: 'email', enabled: true }),
        )
        await vi.advanceTimersByTimeAsync(0)

        expect(calls).toEqual([{ handler: 'sub', params: { enabled: true } }])
        mockClient = createMockClient()
      }
    })

    it('falls back to the command handler for a subcommand nobody claimed', async () => {
      const { ParentController, SubController, calls } = controllers()
      const app = new MeoCordApp(
        [SubController, ParentController] as any,
        createMockContainer() as any,
        mockClient as any,
        't',
      )
      await app.start()

      mockClient.emit('interactionCreate', invoke('settings', { subcommand: 'theme' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual([{ handler: 'parent', params: {} }])
    })

    it('hands the handler resolved options rather than raw snowflakes', async () => {
      const target = createMockInteraction(User, { id: '900', username: 'ada' })
      const params: Record<string, unknown>[] = []

      @Controller()
      class KickController {
        @Command('kick', CommandType.SLASH)
        async kick(_i: unknown, received: Record<string, unknown>) {
          params.push(received)
        }
      }

      const app = new MeoCordApp([KickController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', invoke('kick', { target, reason: 'spam', silent: false }))
      await vi.advanceTimersByTimeAsync(0)

      // `target` is the resolved User, not the snowflake the gateway also sent.
      expect(params).toEqual([{ target, reason: 'spam', silent: false }])
    })

    it('routes an entry point command to its handler', async () => {
      const calls: string[] = []

      @Controller()
      class EntryController {
        @Command('launch', CommandType.PRIMARY_ENTRY_POINT)
        async launch(..._args: any[]) {
          calls.push('launch')
        }
      }

      const app = new MeoCordApp([EntryController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit(
        'interactionCreate',
        createMockInteraction(PrimaryEntryPointCommandInteraction, { commandName: 'launch' }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual(['launch'])
    })
  })

  // Autocomplete has a three-second window and no reply: an interaction nothing answers
  // leaves the client on a loading state until the window closes, with nothing in the log.
  describe('autocomplete dispatch', () => {
    const typing = (commandName: string, options: Parameters<typeof createChatInputOptions>[0]) => {
      const interaction = createMockInteraction(AutocompleteInteraction, { commandName })
      interaction.options = createChatInputOptions(options) as never
      return interaction
    }

    it('routes to the handler declared for the focused option', async () => {
      const calls: { handler: string; params: Record<string, unknown> }[] = []

      @Controller()
      class SearchController {
        @Autocomplete('search', 'query')
        async completeQuery(_i: unknown, params: Record<string, unknown>) {
          calls.push({ handler: 'query', params })
        }

        @Autocomplete('search', 'other')
        async completeOther(..._args: any[]) {
          calls.push({ handler: 'other', params: {} })
        }
      }

      const app = new MeoCordApp([SearchController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', typing('search', { focused: 'query', query: 'ad', scope: 'all' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual([{ handler: 'query', params: { query: 'ad', scope: 'all' } }])
    })

    it('falls back to a command-wide handler for an option nobody named', async () => {
      const calls: string[] = []

      @Controller()
      class SearchController {
        @Autocomplete('search')
        async completeAnything(..._args: any[]) {
          calls.push('anything')
        }
      }

      const app = new MeoCordApp([SearchController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', typing('search', { focused: 'whatever', whatever: 'x' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual(['anything'])
    })

    it('routes a subcommand path', async () => {
      const calls: string[] = []

      @Controller()
      class SettingsController {
        @Autocomplete('settings notify email', 'address')
        async completeAddress(..._args: any[]) {
          calls.push('address')
        }
      }

      const app = new MeoCordApp([SettingsController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit(
        'interactionCreate',
        typing('settings', { subcommandGroup: 'notify', subcommand: 'email', focused: 'address', address: 'a@b.c' }),
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual(['address'])
    })

    // Not repliable, so the "Command not found!" path cannot run for it -- and leaving
    // the window open is what the user sees as a stuck loading state.
    it('closes the window and says which option is unhandled when nothing matches', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = typing('search', { focused: 'query', query: 'ad' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(interaction.respond).toHaveBeenCalledWith([])
      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('autocomplete for "search" option "query"'))
    })

    // The unmatched path ends in an ephemeral "Command not found!" reply, which an
    // autocomplete interaction cannot receive at all.
    it('does not fall through to the command-not-found reply', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = typing('search', { focused: 'query', query: 'ad' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(interaction.respond).toHaveBeenCalledTimes(1)
      expect(interaction.respond).toHaveBeenCalledWith([])
    })

    // `getFocused` throws when nothing is focused. Routing must still reach a
    // command-wide handler rather than letting that escape the listener.
    it('routes to a command-wide handler when no option is focused', async () => {
      const calls: string[] = []

      @Controller()
      class SearchController {
        @Autocomplete('search')
        async completeAnything(_interaction: AutocompleteInteraction) {
          calls.push('anything')
        }
      }

      const app = new MeoCordApp([SearchController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      mockClient.emit('interactionCreate', typing('search', { query: 'ad' }))
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toEqual(['anything'])
    })

    it('closes the window when the handler throws', async () => {
      @Controller()
      class BrokenController {
        @Autocomplete('search', 'query')
        async completeQuery(_interaction: AutocompleteInteraction): Promise<void> {
          throw new Error('lookup failed')
        }
      }

      const app = new MeoCordApp([BrokenController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = typing('search', { focused: 'query', query: 'ad' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(interaction.respond).toHaveBeenCalledWith([])
      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).toHaveBeenCalledWith(expect.stringContaining('autocomplete for "search"'), expect.any(Error))
    })
  })

  // A validation failure is about the caller's own input, so only they see which part was wrong.
  it('answers invalid input privately with its issues, and never runs the handler', async () => {
    const ran = vi.fn()
    const minutes: StandardSchemaV1<unknown, { minutes: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value: unknown) =>
          (value as { minutes?: number }).minutes! > 0
            ? { value: value as { minutes: number } }
            : { issues: [{ message: 'Must be at least 1', path: ['minutes'] }] },
      },
    }

    @Controller()
    class RemindController {
      @Command('remind', CommandType.SLASH)
      @Validate(minutes)
      async remind(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {
        ran()
      }
    }

    await new MeoCordApp([RemindController] as any, createMockContainer() as any, mockClient as any, 't').start()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'remind' })
    interaction.options = createChatInputOptions({ minutes: 0 }) as never

    await mockClient.listenersFor('interactionCreate')[0](interaction)

    expect(ran).not.toHaveBeenCalled()
    expect(errorShown(interaction.reply)).toBe('minutes: Must be at least 1')
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }))
  })

  // A modal handler's second argument carries the customId params and the submitted fields together.
  describe('modal input', () => {
    const received: unknown[] = []

    @Controller()
    class FeedbackController {
      @Command('feedback/{topic}', CommandType.MODAL_SUBMIT)
      async feedback(_interaction: ModalSubmitInteraction, params: Record<string, unknown>) {
        received.push(params)
      }
    }

    const submit = (values: Record<string, string>) =>
      createMockInteraction(ModalSubmitInteraction, {
        customId: 'feedback/bugs',
        fields: createModalFields(values),
      })

    const dispatch = async (values: Record<string, string>) => {
      await mockClient.listenersFor('interactionCreate')[0](submit(values))
    }

    beforeEach(async () => {
      received.length = 0
      await new MeoCordApp([FeedbackController] as any, createMockContainer() as any, mockClient as any, 't').start()
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('passes the fields with the customId params', async () => {
      await dispatch({ body: 'It crashed' })

      expect(received).toEqual([{ topic: 'bugs', body: 'It crashed' }])
    })

    it('keeps the customId param over a field of the same name, and warns once in development', async () => {
      vi.stubEnv('NODE_ENV', 'development')

      await dispatch({ topic: 'typed' })
      await dispatch({ topic: 'typed again' })

      expect(received).toEqual([{ topic: 'bugs' }, { topic: 'bugs' }])
      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn.mock.calls.filter(([message]: [string]) => message.includes('"topic" is both'))).toHaveLength(1)
    })

    it('does not warn in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')

      await dispatch({ topic: 'typed' })

      const warn = vi.mocked(Logger).mock.results[0]?.value.warn
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"topic" is both'))
    })
  })

  // What the module does with the payload is pinned in command-registration.spec.ts; these pin the call site.
  describe('registerCommands()', () => {
    class PingBuilder {
      build = () => ({ toJSON: () => ({ name: 'ping', type: 1, description: 'Pong' }) }) as any
    }
    Reflect.defineMetadata('commandType', CommandType.SLASH, PingBuilder)

    @Controller()
    class PingController {
      @Command('ping', PingBuilder as any)
      async ping(..._args: any[]) {}
    }

    const withRest = (put = vi.fn().mockResolvedValue([])) => {
      Object.assign(mockClient, { application: { id: 'app-id' }, rest: { put, get: vi.fn().mockResolvedValue([]) } })
      return put
    }

    it('sends the commands globally over the client\'s REST once ready', async () => {
      const put = withRest()
      const app = new MeoCordApp([PingController] as any, createMockContainer() as any, mockClient as any, 't')

      await app.registerCommands()

      expect(put).toHaveBeenCalledWith('/applications/app-id/commands', {
        body: [{ name: 'ping', type: 1, description: 'Pong' }],
      })
    })

    it('constructs no controller to read the commands', async () => {
      withRest()
      const container = createMockContainer()
      const app = new MeoCordApp([PingController] as any, container as any, mockClient as any, 't')

      await app.registerCommands()

      expect(container.get).not.toHaveBeenCalled()
    })

    it('logs a rejected registration and resolves, so the bot stays online', async () => {
      withRest(vi.fn().mockRejectedValue(new Error('Invalid Form Body')))
      const app = new MeoCordApp([PingController] as any, createMockContainer() as any, mockClient as any, 't')

      await expect(app.registerCommands()).resolves.toBeUndefined()

      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Error registering commands globally'), expect.any(Error))
    })

    it('keeps the ready listener\'s other work going when registration fails', async () => {
      withRest(vi.fn().mockRejectedValue(new Error('Invalid Form Body')))
      const app = new MeoCordApp([PingController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      await Promise.all(mockClient.listenersFor('clientReady').map(listener => listener()))

      expect(mockClient.login).toHaveBeenCalled()
      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Unhandled error while handling "clientReady"'), expect.anything())
    })

    it('sends nothing when the configuration turns startup registration off', async () => {
      const put = withRest()
      mockLoadConfig.mockReturnValueOnce({ discordToken: 't', commands: { register: false } })
      const app = new MeoCordApp([PingController] as any, createMockContainer() as any, mockClient as any, 't')

      await app.registerCommands()

      expect(put).not.toHaveBeenCalled()
    })

    it('sends nothing before the application is known', async () => {
      const put = withRest()
      mockClient.application = null
      const app = new MeoCordApp([PingController] as any, createMockContainer() as any, mockClient as any, 't')

      await app.registerCommands()

      expect(put).not.toHaveBeenCalled()
    })
  })

  // Replying twice throws, and it would throw from inside the catch block -- past
  // anything left to handle it, and out of the interactionCreate listener.
  describe('handler failures', () => {
    const failing = (body: (interaction: any) => Promise<void>) => {
      @Controller()
      class FailingController {
        @Command('boom/{id}', CommandType.BUTTON)
        async handle(interaction: any) {
          await body(interaction)
        }
      }
      return FailingController
    }

    it('reports an error the handler threw before replying', async () => {
      const FailingController = failing(async () => {
        throw new Error('handler blew up')
      })
      const app = new MeoCordApp([FailingController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = createMockInteraction(ButtonInteraction, { customId: 'boom/1' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(errorShown(interaction.reply)).toBe('An error occurred while executing the command.')
    })

    it('follows up privately, rather than replying again, when the handler replied and then threw', async () => {
      const FailingController = failing(async interaction => {
        await interaction.reply('partial')
        throw new Error('handler blew up after replying')
      })
      const app = new MeoCordApp([FailingController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = createMockInteraction(ButtonInteraction, { customId: 'boom/1' })
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(interaction.reply).toHaveBeenCalledTimes(1)
      expect(interaction.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }))
      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom/1'), expect.any(Error))
    })

    it('answers a deferred command that threw by editing its deferred reply', async () => {
      @Controller()
      class DeferringController {
        @Command('slow', CommandType.SLASH)
        async slow(interaction: ChatInputCommandInteraction) {
          await interaction.deferReply()
          throw new Error('failed after deferring')
        }
      }
      const app = new MeoCordApp([DeferringController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'slow' })
      interaction.options = createChatInputOptions({})
      mockClient.emit('interactionCreate', interaction)
      await vi.advanceTimersByTimeAsync(0)

      expect(errorShown(interaction.editReply)).toBe('An error occurred while executing the command.')
      expect(interaction.editReply).toHaveBeenCalledTimes(1)
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('survives an interaction that rejects the error reply', async () => {
      const FailingController = failing(async () => {
        throw new Error('handler blew up')
      })
      const app = new MeoCordApp([FailingController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const interaction = createMockInteraction(ButtonInteraction, { customId: 'boom/1' })
      interaction.reply.mockRejectedValue(new Error('Unknown interaction'))

      const listener = mockClient.listenersFor('interactionCreate')[0]
      await expect(listener(interaction)).resolves.toBeUndefined()
    })
  })

  // discord.js calls listeners without awaiting them, so anything that rejects out of
  // one is an unhandled rejection -- which terminates the process by default. None of
  // these failures should be able to take the bot down.
  describe('listener resilience', () => {
    const throwingContainer = () => ({
      get: vi.fn(() => {
        throw new Error('No matching bindings found for serviceIdentifier')
      }),
      isBound: vi.fn().mockReturnValue(false),
    })

    @Controller()
    class UnresolvableController {
      @Command('boom/{id}', CommandType.BUTTON)
      async handle(..._args: any[]) {}

      @Autocomplete('search', 'query')
      async complete(_interaction: AutocompleteInteraction) {}

      @ReactionHandler()
      async react(..._args: any[]) {}

      @MessageHandler()
      async listen(..._args: any[]) {}
    }

    const startWithBrokenContainer = async () => {
      const app = new MeoCordApp([UnresolvableController] as any, throwingContainer() as any, mockClient as any, 't')
      await app.start()
      return app
    }

    // A controller that cannot be constructed is a misconfiguration, and it surfaces on
    // the first interaction -- loudly, but without losing every other user's session.
    it('survives a controller the container cannot resolve, and says so', async () => {
      await startWithBrokenContainer()

      const interaction = createMockInteraction(ButtonInteraction, { customId: 'boom/1' })
      const listener = mockClient.listenersFor('interactionCreate')[0]

      await expect(listener(interaction)).resolves.toBeUndefined()

      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).toHaveBeenCalledWith(expect.stringContaining('boom/1'), expect.any(Error))
    })

    it('still tells the user the interaction failed', async () => {
      await startWithBrokenContainer()

      const interaction = createMockInteraction(ButtonInteraction, { customId: 'boom/1' })
      await mockClient.listenersFor('interactionCreate')[0](interaction)

      expect(errorShown(interaction.reply)).toBe('An error occurred while executing the command.')
    })

    // Autocomplete cannot be replied to, so closing its window is the only way the
    // client stops showing a loading state.
    it('closes the autocomplete window when dispatch itself fails', async () => {
      await startWithBrokenContainer()

      const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
      interaction.options = createChatInputOptions({ focused: 'query', query: 'ad' }) as never

      await expect(mockClient.listenersFor('interactionCreate')[0](interaction)).resolves.toBeUndefined()
      expect(interaction.respond).toHaveBeenCalledWith([])
    })

    it('survives a failing controller on messageCreate', async () => {
      await startWithBrokenContainer()

      const message = { author: { bot: false }, content: 'hello' }

      await expect(mockClient.listenersFor('messageCreate')[0](message)).resolves.toBeUndefined()

      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).toHaveBeenCalledWith(expect.stringContaining('messageCreate'), expect.any(Error))
    })

    // A reaction arrives for messages the bot can no longer read -- deleted, or in a
    // channel it lost access to. That is ordinary, not a fault.
    it('skips a reaction whose message cannot be fetched, without running handlers', async () => {
      const calls: string[] = []

      @Controller()
      class ReactController {
        @ReactionHandler()
        async react(_reaction: MessageReaction) {
          calls.push('react')
        }
      }

      const app = new MeoCordApp([ReactController] as any, createMockContainer() as any, mockClient as any, 't')
      await app.start()

      const reaction = {
        emoji: { name: '👍' },
        message: { fetch: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Unknown Message')) },
      }

      const listener = mockClient.listenersFor('messageReactionAdd')[0]
      await expect(listener(reaction, { id: 'user-1' })).resolves.toBeUndefined()

      expect(calls).toEqual([])
      const error = vi.mocked(Logger).mock.results[0]?.value.error
      expect(error).not.toHaveBeenCalled()
    })

    // The activity rotation runs on a timer, where a throw is an uncaught exception no
    // listener wrapper can reach.
    it('survives an activity update that throws', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token', [{ name: 'Playing' }])
      await app.start()

      mockClient.user.setActivity.mockImplementation(() => {
        throw new Error('shard not ready')
      })
      mockClient.emit('clientReady')

      expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
    })
  })

  describe('shutdownAndExit()', () => {
    it('destroys the client and clears the activity interval', async () => {
      const app = new MeoCordApp([], createMockContainer() as any, mockClient as any, 'token', [{ name: 'Playing' }])
      await app.start()

      mockClient.emit('clientReady')
      vi.advanceTimersByTime(10000)

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await shutdownAndExit()

      expect(mockClient.destroy).toHaveBeenCalled()
      expect(mockClient.removeAllListeners).toHaveBeenCalled()
      expect(exitSpy).toHaveBeenCalledWith(0)

      exitSpy.mockRestore()
    })
  })
})
