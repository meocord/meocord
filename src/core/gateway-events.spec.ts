import { vi } from 'vitest'
import {
  ChatInputCommandInteraction,
  Client,
  type ClientOptions,
  GatewayIntentBits,
  type GuildMember,
  type PartialGuildMember,
  Message,
  MessageReaction,
  Partials,
} from 'discord.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { GuardDeniedError, UserError } from '@src/common/errors.js'
import {
  Catch,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  MessageHandler,
  On,
  Once,
  ReactionHandler,
  Service,
  UseFilter,
  UseGuard,
  UseInterceptor,
} from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import {
  type CallHandler,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type MessageCommandOptions,
} from '@src/interface/index.js'
import { createMockInteraction, createMockMessage } from '@src/testing/index.js'

const { logged } = vi.hoisted(() => ({
  logged: { error: [] as unknown[][], warn: [] as unknown[][], info: [] as unknown[][], debug: [] as unknown[][] },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = (...args: unknown[]) => logged.debug.push(args)
    info = (...args: unknown[]) => logged.info.push(args)
    verbose = vi.fn()
    error = (...args: unknown[]) => logged.error.push(args)
    warn = (...args: unknown[]) => logged.warn.push(args)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** Starts an app built by the factory, with a client that logs in without a network. */
async function startApp(
  options: { controllers?: any[]; services?: any[]; guards?: any[]; interceptors?: any[]; messages?: MessageCommandOptions },
  clientOptions: ClientOptions = { intents: [] },
): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })

  @MeoCord({
    controllers: options.controllers ?? [],
    services: options.services,
    guards: options.guards,
    interceptors: options.interceptors,
    messages: options.messages,
    clientOptions,
  })
  class App {}

  await MeoCordFactory.create(App).start()
  return clients[0]
}

/** Emits an event and waits for every listener the app attached for it to settle. */
async function emit(client: Client, event: string, ...args: unknown[]): Promise<void> {
  await Promise.all(client.rawListeners(event).map(listener => (listener as (...a: unknown[]) => unknown)(...args)))
}

const member = { id: 'member-1' } as unknown as GuildMember

describe('gateway event handlers', () => {
  beforeEach(() => {
    logged.error.length = 0
    logged.warn.length = 0
    logged.info.length = 0
    logged.debug.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs @On handlers on controllers and services with the event arguments', async () => {
    const seen: [string, unknown][] = []

    @Service()
    class WelcomeService {
      @On('guildMemberAdd')
      greet(joined: GuildMember) {
        seen.push(['service', joined])
      }
    }

    @Controller()
    class AuditController {
      @On('guildMemberAdd')
      record(joined: GuildMember) {
        seen.push(['controller', joined])
      }
    }

    const client = await startApp({ controllers: [AuditController], services: [WelcomeService] })
    await emit(client, 'guildMemberAdd', member)

    expect(seen).toEqual([
      ['service', member],
      ['controller', member],
    ])
  })

  it('resolves a dependency with handlers only when its first event arrives', async () => {
    const constructed = vi.fn()

    @Service()
    class Tracker {
      constructor() {
        constructed()
      }
      @On('guildMemberAdd')
      track() {}
    }

    @Controller()
    class UsesTracker {
      constructor(readonly tracker: Tracker) {}
    }

    const client = await startApp({ controllers: [UsesTracker] })
    expect(constructed).not.toHaveBeenCalled()

    await emit(client, 'guildMemberAdd', member)
    expect(constructed).toHaveBeenCalledTimes(1)
  })

  it('runs an @Once handler for the first event only', async () => {
    const ready = vi.fn()

    @Service()
    class Warmup {
      @Once('clientReady')
      warm() {
        ready()
      }
    }

    const client = await startApp({ services: [Warmup] })
    await emit(client, 'clientReady', client)
    await emit(client, 'clientReady', client)

    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('logs an error against the event and handler, and still runs the other listeners', async () => {
    const ran = vi.fn()

    @Service()
    class Broken {
      @On('guildMemberAdd')
      fail() {
        throw new Error('boom')
      }
    }

    @Service()
    class Healthy {
      @On('guildMemberAdd')
      greet() {
        ran()
      }
    }

    const client = await startApp({ services: [Broken, Healthy] })
    await expect(emit(client, 'guildMemberAdd', member)).resolves.toBeUndefined()

    expect(ran).toHaveBeenCalled()
    expect(logged.error).toContainEqual(['Error handling event "guildMemberAdd" in Broken.fail:', new Error('boom')])
  })

  it("answers a UserError from a handler of a message event, as a message command's is answered, and logs no error", async () => {
    @Service()
    class Linking {
      @On('messageCreate')
      created() {
        throw new UserError('Link your account first.')
      }

      @On('messageUpdate')
      edited() {
        throw new UserError('Edits are not checked again.')
      }

      @On('guildMemberAdd')
      joined() {
        throw new UserError('No one to tell.')
      }
    }
    const client = await startApp({ services: [Linking] })
    const sent = createMockMessage({ content: 'hi' })
    const [before, after] = [createMockMessage({ content: 'old' }), createMockMessage({ content: 'new' })]

    await emit(client, 'messageCreate', sent)
    await emit(client, 'messageUpdate', before, after)
    await emit(client, 'guildMemberAdd', member)

    expect(sent.reply).toHaveBeenCalledWith({ content: 'Link your account first.', allowedMentions: { repliedUser: false, parse: [] } })
    expect(after.reply).toHaveBeenCalledWith({ content: 'Edits are not checked again.', allowedMentions: { repliedUser: false, parse: [] } })
    expect(before.reply).not.toHaveBeenCalled()
    expect(logged.error).toEqual([])
  })

  it('gives a service the app\'s HandlerRegistry, listing the app\'s handlers', async () => {
    let registry: HandlerRegistry | undefined

    @Service()
    class HelpService {
      constructor(handlers: HandlerRegistry) {
        registry = handlers
      }
      @On('guildMemberAdd')
      greet() {}
    }

    await startApp({ services: [HelpService] })

    expect(registry?.list({ kind: 'event' }).map(entry => `${entry.controller.name}.${entry.method}`)).toEqual([
      'HelpService.greet',
    ])
  })

  describe('guards', () => {
    it('runs a class-level guard before an @On handler, with the event arguments and type "event"', async () => {
      const calls: { first: unknown; type: string }[] = []
      const handled = vi.fn()

      @Guard()
      class EventGuard implements GuardInterface {
        constructor(private readonly context: ExecutionContext) {}
        canActivate(first: unknown) {
          calls.push({ first, type: this.context.getType() })
          return false
        }
      }

      @Controller()
      @UseGuard(EventGuard)
      class ModerationController {
        @On('messageCreate')
        watch(_message: Message) {
          handled()
        }
      }

      const client = await startApp({ controllers: [ModerationController] })
      const message = createMockMessage()
      await emit(client, 'messageCreate', message)

      // A message event still reads as an event, not as a @MessageHandler call
      expect(calls).toEqual([{ first: message, type: 'event' }])
      expect(handled).not.toHaveBeenCalled()
    })

    it('runs the guards once for an event whose first argument is not an object', async () => {
      const canActivate = vi.fn(() => true)
      const handled = vi.fn()

      @Guard()
      class CountingGuard implements GuardInterface {
        canActivate = canActivate
      }

      @Service()
      class DebugLog {
        @On('debug')
        @UseGuard(CountingGuard)
        log(info: string) {
          handled(info)
        }
      }

      const client = await startApp({ services: [DebugLog] })
      await emit(client, 'debug', 'heartbeat')

      expect(canActivate).toHaveBeenCalledTimes(1)
      expect(handled).toHaveBeenCalledWith('heartbeat')
    })
  })

  describe('interceptors', () => {
    it("runs an @On handler's own interceptor around it, with type \"event\"", async () => {
      const order: string[] = []

      @Interceptor()
      class Timing implements InterceptorInterface {
        async intercept(context: ExecutionContext, next: CallHandler) {
          order.push(`before ${context.getType()}`)
          const result = await next.handle()
          order.push('after')
          return result
        }
      }

      @Service()
      class Welcome {
        @On('guildMemberAdd')
        @UseInterceptor(Timing)
        greet() {
          order.push('handler')
        }
      }

      const client = await startApp({ services: [Welcome] })
      await emit(client, 'guildMemberAdd', member)

      expect(order).toEqual(['before event', 'handler', 'after'])
    })
  })

  describe('filters and the fallback', () => {
    it('hands an event handler\'s error to its filters, and logs nothing when one handles it', async () => {
      const handled: unknown[] = []

      @Catch()
      class EventErrors implements ExceptionFilter {
        catch(error: unknown, context: ExecutionContext) {
          handled.push([(error as Error).message, context.getType(), context.getHandlerName()])
        }
      }

      @Service()
      @UseFilter(EventErrors)
      class Welcome {
        @On('guildMemberAdd')
        greet() {
          throw new Error('boom')
        }
      }

      const client = await startApp({ services: [Welcome] })
      await emit(client, 'guildMemberAdd', member)

      expect(handled).toEqual([['boom', 'event', 'greet']])
      expect(logged.error).toEqual([])
    })

    // The message's author wrote the text these errors quote, so its line breaks stay on the debug line
    it("escapes a refusal's or a denial's message in its debug line", async () => {
      @Guard()
      class EditGuard implements GuardInterface {
        canActivate(_before: Message, after: Message): boolean {
          throw new GuardDeniedError(`Edit ignored: ${after.content}`)
        }
      }

      @Service()
      class Search {
        @On('messageCreate')
        query(message: Message) {
          throw new UserError(`Unknown query ${message.content}`)
        }

        @On('messageUpdate')
        @UseGuard(EditGuard)
        edited() {
          return undefined
        }
      }

      const client = await startApp({ services: [Search] })
      const message = createMockMessage({ content: '?q\n[ERROR] [MeoCordApp] Fake line' })
      await emit(client, 'messageCreate', message)
      await emit(client, 'messageUpdate', createMockMessage({ content: 'old' }), message)

      expect(logged.debug).toContainEqual(['Refused event "messageCreate" in Search.query: Unknown query ?q\\n[ERROR] [MeoCordApp] Fake line'])
      expect(logged.debug).toContainEqual(['Denied event "messageUpdate" in Search.edited: Edit ignored: ?q\\n[ERROR] [MeoCordApp] Fake line'])
    })

    it('only logs an unhandled error from an event handler, even when its argument is an interaction', async () => {
      @Controller()
      class Audit {
        @On('interactionCreate')
        record() {
          throw new Error('audit failed')
        }
      }

      const client = await startApp({ controllers: [Audit] })
      const interaction = createMockInteraction(ChatInputCommandInteraction)
      // Only the @On listener: MeoCord's own dispatch of interactionCreate is not under test here
      const listener = client.rawListeners('interactionCreate').at(-1) as (...a: unknown[]) => Promise<void>
      await listener(interaction)

      expect(interaction.reply).not.toHaveBeenCalled()
      expect(logged.error).toContainEqual([
        'Error handling event "interactionCreate" in Audit.record:',
        new Error('audit failed'),
      ])
    })
  })

  describe('global stages', () => {
    it('keeps a listener alive when a global guard written for interactions throws on an event', async () => {
      const greeted = vi.fn()

      @Guard()
      class RolesGuard implements GuardInterface {
        canActivate(interaction: { user: { id: string } }) {
          return interaction.user.id === 'admin'
        }
      }

      @Service()
      class Welcome {
        @On('guildMemberAdd')
        greet() {
          greeted()
        }
      }

      @Service()
      class Audit {
        @On('guildMemberAdd')
        record() {
          greeted()
        }
      }

      const client = await startApp({ services: [Welcome, Audit], guards: [RolesGuard] })
      await expect(emit(client, 'guildMemberAdd', { id: 'member-1' })).resolves.toBeUndefined()

      // The guard throws before either handler, for both listeners; both errors are logged, nothing escapes
      expect(greeted).not.toHaveBeenCalled()
      expect(logged.error.map(args => args[0])).toEqual([
        'Error handling event "guildMemberAdd" in Welcome.greet:',
        'Error handling event "guildMemberAdd" in Audit.record:',
      ])
    })

    it('notes once per global guard or interceptor without types that it also runs on events', async () => {
      @Guard()
      class RolesGuard implements GuardInterface {
        canActivate() {
          return true
        }
      }

      @Guard({ types: ['interaction'] })
      class ScopedGuard implements GuardInterface {
        canActivate() {
          return true
        }
      }

      @Interceptor()
      class Timing implements InterceptorInterface {
        intercept(_context: unknown, next: CallHandler) {
          return next.handle()
        }
      }

      @Service()
      class Welcome {
        @On('guildMemberAdd')
        greet() {}
        @On('guildMemberRemove')
        farewell() {}
      }

      await startApp({ services: [Welcome], guards: [RolesGuard, ScopedGuard], interceptors: [Timing] })

      expect(logged.info.map(args => args[0])).toEqual([
        'Global guard RolesGuard also runs on gateway events; declare @Guard({ types: [...] }) to limit it.',
        'Global interceptor Timing also runs on gateway events; declare @Interceptor({ types: [...] }) to limit it.',
      ])
    })

    it('notes nothing when the app has no event handlers', async () => {
      @Guard()
      class RolesGuard implements GuardInterface {
        canActivate() {
          return true
        }
      }

      await startApp({ services: [], guards: [RolesGuard] })

      expect(logged.info).toEqual([])
    })
  })

  describe('failures and misuse', () => {
    it('logs a handler whose instance cannot be resolved, and keeps the listener for the next event', async () => {
      let attempts = 0

      @Controller()
      class Broken {
        constructor() {
          attempts++
          throw new Error('no database')
        }

        @On('guildMemberAdd')
        greet() {}
      }

      const client = await startApp({ controllers: [Broken] })
      await emit(client, 'guildMemberAdd', member)
      await emit(client, 'guildMemberAdd', member)

      expect(attempts).toBe(2)
      expect(logged.error).toHaveLength(2)
      expect(String(logged.error[0][0])).toContain('"guildMemberAdd" in Broken.greet')
      expect(client.listenerCount('guildMemberAdd')).toBe(1)
    })

    // Standalone services are created at startup, so a failing one stops the app before it goes online
    it('stops startup with the error of a standalone service whose constructor throws', async () => {
      @Service()
      class Broken {
        constructor() {
          throw new Error('no database')
        }

        @On('guildMemberAdd')
        greet() {}
      }

      await expect(startApp({ services: [Broken] })).rejects.toThrow('no database')
    })

    it('logs a handler that throws synchronously, like one that rejects', async () => {
      @Service()
      class Sync {
        @On('guildMemberAdd')
        greet() {
          throw new Error('sync failure')
        }
      }

      const client = await startApp({ services: [Sync] })
      await expect(emit(client, 'guildMemberAdd', member)).resolves.toBeUndefined()

      expect(logged.error).toHaveLength(1)
      expect(logged.error[0][1]).toEqual(new Error('sync failure'))
    })

    it('runs an @Once handler that threw only once', async () => {
      let runs = 0

      @Service()
      class Warmup {
        @Once('guildMemberAdd')
        warm() {
          runs++
          throw new Error('cold')
        }
      }

      const client = await startApp({ services: [Warmup] })
      await emit(client, 'guildMemberAdd', member)
      await emit(client, 'guildMemberAdd', member)

      expect(runs).toBe(1)
      expect(logged.error).toHaveLength(1)
    })

    it('runs an inherited @On once, on the subclass bound', async () => {
      const seen: string[] = []

      class BaseAudit {
        @On('guildMemberAdd')
        record() {
          seen.push(this.constructor.name)
        }
      }

      @Service()
      class GuildAudit extends BaseAudit {}

      const client = await startApp({ services: [GuildAudit] })
      await emit(client, 'guildMemberAdd', member)

      expect(seen).toEqual(['GuildAudit'])
    })

    it('handles each event a method is declared for', async () => {
      const seen: string[] = []

      @Service()
      class Presence {
        @On('guildMemberAdd')
        @On('guildMemberRemove')
        track(changed: GuildMember | PartialGuildMember) {
          seen.push(changed.id)
        }
      }

      const client = await startApp({ services: [Presence] })
      await emit(client, 'guildMemberAdd', member)
      await emit(client, 'guildMemberRemove', member)

      expect(seen).toEqual(['member-1', 'member-1'])
    })

    it('attaches nothing for a class the app does not bind', async () => {
      class Unbound {
        @On('guildMemberAdd')
        greet() {}
      }
      void Unbound

      const client = await startApp({})

      expect(client.listenerCount('guildMemberAdd')).toBe(0)
    })
  })

  describe('intents and partials', () => {
    it('warns once per missing intent, naming every handler and saying it is privileged', async () => {
      @Service()
      class Welcome {
        @On('guildMemberAdd')
        greet() {}
        @On('guildMemberRemove')
        farewell() {}
      }

      await startApp({ services: [Welcome] }, { intents: [GatewayIntentBits.Guilds] })

      const warnings = logged.warn.map(args => String(args[0])).filter(text => text.includes('GuildMembers'))
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("@On('guildMemberAdd') in Welcome.greet")
      expect(warnings[0]).toContain("@On('guildMemberRemove') in Welcome.farewell")
      expect(warnings[0]).toContain('privileged')
    })

    // They never run, which another warning says, so no intent or partial is asked for them
    it('leaves out the message and reaction handlers of a class that is not a controller', async () => {
      @Service()
      class Stats {
        @MessageHandler('stats')
        stats(_message: Message) {}
        @ReactionHandler('👍')
        like(_reaction: MessageReaction) {}
        @On('guildMemberAdd')
        greet() {}
      }

      await startApp({ services: [Stats] }, { intents: [GatewayIntentBits.Guilds] })

      expect(logged.warn.map(args => String(args[0])).filter(text => text.includes('in Stats.'))).toEqual([
        expect.stringContaining("@On('guildMemberAdd') in Stats.greet"),
      ])
    })

    it('checks @MessageHandler for MessageContent and @ReactionHandler for its partials', async () => {
      @Controller()
      class Chat {
        @MessageHandler('ping')
        ping(_message: Message) {}
        @ReactionHandler('👍')
        like(_reaction: MessageReaction) {}
      }

      await startApp(
        { controllers: [Chat] },
        { intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions] },
      )

      const warnings = logged.warn.map(args => String(args[0])).join('\n')
      expect(warnings).toContain("MessageContent intent is not in clientOptions.intents, so Discord will not send what @MessageHandler('ping') in Chat.ping")
      expect(warnings).toContain("Partials.Message is not in clientOptions.partials, so @ReactionHandler('👍') in Chat.like")
    })

    it('asks no MessageContent for commands only a mention of the bot or a direct message reaches', async () => {
      @Controller()
      class Mentioned {
        @MessageHandler('ping')
        ping(_message: Message) {}
      }
      @Controller()
      class Mixed {
        // A mention alone starts it, whatever the app's prefix
        @MessageHandler('status', { mention: 'only' })
        status(_message: Message) {}
        // Direct messages carry their text, whatever starts them
        @MessageHandler('inbox', { scope: 'dm' })
        inbox(_message: Message) {}
        @MessageHandler('roll {sides}')
        roll(_message: Message) {}
        @MessageHandler()
        everything(_message: Message) {}
      }
      const contentWarnings = () => logged.warn.map(args => String(args[0])).filter(text => text.includes('MessageContent'))
      const intents = { intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages] }

      await startApp({ controllers: [Mentioned], messages: { mention: 'only' } }, intents)
      expect(contentWarnings()).toEqual([])

      await startApp({ controllers: [Mixed], messages: { prefix: '!' } }, intents)
      const [warning] = contentWarnings()
      // Still asked for a prefixed command and a listener, and the warning says what arrives without it
      expect(warning).toContain("@MessageHandler('roll {sides}') in Mixed.roll, @MessageHandler() in Mixed.everything")
      expect(warning).not.toContain('Mixed.status')
      expect(warning).not.toContain('Mixed.inbox')
      expect(warning).toContain("only messages that mention the bot and direct messages carry their text; messages: { mention: 'only' } needs none.")
    })

    // A direct message arrives only with DirectMessages, and only with Partials.Channel, since no DM channel is cached
    it("asks a scope: 'dm' command for what lets direct messages arrive, and a server command for none of it", async () => {
      @Controller()
      class Rewards {
        @MessageHandler('daily', { scope: 'dm' })
        daily(_message: Message) {}
        @MessageHandler('rank')
        rank(_message: Message) {}
      }
      const dmWarnings = () =>
        logged.warn.map(args => String(args[0])).filter(text => text.includes('DirectMessages') || text.includes('Partials.Channel'))

      // The generated app's intents and partials
      await startApp(
        { controllers: [Rewards], messages: { prefix: '!' } },
        {
          intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
          partials: [Partials.Message, Partials.Reaction],
        },
      )
      expect(dmWarnings()).toEqual([
        "The DirectMessages intent is not in clientOptions.intents, so Discord will not send what @MessageHandler('daily') in Rewards.daily handles.",
        "Partials.Channel is not in clientOptions.partials, so @MessageHandler('daily') in Rewards.daily will miss direct messages: no DM " +
          'channel is cached after the bot starts, and discord.js drops a message from a channel it has not cached.',
      ])

      logged.warn.length = 0
      await startApp(
        { controllers: [Rewards], messages: { prefix: '!' } },
        {
          intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
          partials: [Partials.Channel],
        },
      )
      expect(dmWarnings()).toEqual([])
    })

    it("leaves mention: 'only' out of the MessageContent warning when only a listener needs the intent", async () => {
      @Controller()
      class Listening {
        @MessageHandler()
        everything(_message: Message) {}
      }

      await startApp({ controllers: [Listening] }, { intents: [GatewayIntentBits.GuildMessages] })

      const [warning] = logged.warn.map(args => String(args[0])).filter(text => text.includes('MessageContent'))
      expect(warning).toContain('only messages that mention the bot and direct messages carry their text.')
      expect(warning).not.toContain("mention: 'only'")
    })

    it('says nothing when the client options cover every handler', async () => {
      @Controller()
      class Chat {
        @MessageHandler()
        any(_message: Message) {}
        @ReactionHandler()
        react(_reaction: MessageReaction) {}
        @On('guildMemberAdd')
        greet() {}
        @On('clientReady')
        ready() {}
      }

      await startApp(
        { controllers: [Chat] },
        {
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent,
          ],
          partials: [Partials.Message, Partials.Reaction],
        },
      )

      expect(logged.warn).toEqual([])
    })
  })
})
