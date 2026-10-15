import 'reflect-metadata'
import { vi } from 'vitest'
import { type Message } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule, resolveRoute, useStrictMocks } from '@src/testing/index.js'
import { forgetStrictMocks } from '@src/testing/strict-mocks.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'

const CHANNEL = '123456789012345678'

// Where a command with a `member`, `role` or `channel` flag works, as dispatch, help, HandlerRegistry and resolveRoute
// each read it: a required flag of those types narrows it to servers, and an optional one refuses a DM only when given
describe('a message command with a flag only a server has', () => {
  const ran: string[] = []

  @Controller()
  class Posts {
    @MessageHandler('post {text...} {--in:channel?}')
    post() {
      ran.push('post')
    }

    @MessageHandler('pin {text...} {--in:channel}')
    pin() {
      ran.push('pin')
    }

    @MessageHandler('kick {who:member?}')
    kick() {
      ran.push('kick')
    }

    @MessageHandler('ping')
    ping() {
      ran.push('ping')
    }
  }

  @MeoCord({ controllers: [Posts], clientOptions: { intents: [] }, messages: { prefix: '!', help: true } })
  class App {}

  const replyOf = (message: Message) => (vi.mocked(message.reply).mock.calls[0]?.[0] as { content?: string } | undefined)?.content

  async function inDm(content: string) {
    ran.length = 0
    const message = createMockMessage({ content, guild: null })
    await MeoCordTestingModule.fromApp(App).compile().dispatch(message)
    return { ran: [...ran], reply: replyOf(message) }
  }

  it('runs a command whose server-only flag is optional in a DM, and refuses it there once the flag is given', async () => {
    expect(await inDm('!post hello')).toEqual({ ran: ['post'], reply: undefined })
    expect(await inDm(`!post hello --in=${CHANNEL}`)).toEqual({ ran: [], reply: 'This command works in a server only.' })
  })

  it('says a command with a required server-only flag works in a server only, given the flag or not', async () => {
    expect(await inDm('!pin hello')).toEqual({ ran: [], reply: 'This command works in a server only.' })
    expect(await inDm(`!pin hello --in=${CHANNEL}`)).toEqual({ ran: [], reply: 'This command works in a server only.' })
  })

  it('still asks for a required server-only flag in a server', async () => {
    ran.length = 0
    const message = createMockMessage({ content: '!pin hello', guild: createMockGuild() })
    await MeoCordTestingModule.fromApp(App).compile().dispatch(message)

    expect(ran).toEqual([])
    expect(replyOf(message)).toBe('Usage: !pin <text…> --in=<in>\n--in is missing')
  })

  it("lists in a DM's help a command whose server-only flag is optional, and no other server-only one", async () => {
    expect((await inDm('!help')).reply).toBe('Commands:\n!ping\n!post <text…> [--in=<in>]\nType !help <command> for one command\'s usage.')
    expect((await inDm('!help post')).reply).not.toContain('Works in servers only.')
    expect((await inDm('!help pin')).reply).toContain('Works in servers only.')
    expect((await inDm('!help kick')).reply).toContain('Works in servers only.')
  })

  it('gives HandlerRegistry the scope dispatch keeps', () => {
    const registry = MeoCordTestingModule.fromApp(App).compile().get(HandlerRegistry)
    const scopes = Object.fromEntries(registry.list({ kind: 'message' }).map(entry => [entry.name, entry.scope]))

    expect(scopes).toEqual({
      'post {text...} {--in:channel?}': 'any',
      'pin {text...} {--in:channel}': 'guild',
      'kick {who:member?}': 'guild',
      ping: 'any',
    })
  })

  describe('resolveRoute in a DM', () => {
    const resolved = (content: string) => resolveRoute(App, { content, dm: true })?.method
    let warned: string[]
    beforeEach(() => {
      forgetStrictMocks()
      forgetDeprecationWarnings()
      warned = []
      vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
    })
    afterEach(() => vi.restoreAllMocks())
    afterAll(() => forgetStrictMocks())

    it('resolves a command whose server-only flag is optional and not given, and none with a server-only param', () => {
      expect(resolved('!post hello')).toBe('post')
      expect(resolved('!kick')).toBeUndefined()
      expect(resolveRoute(App, { content: `!pin hello --in=${CHANNEL}` })?.method).toBe('pin')
      expect(warned).toEqual([])
    })

    it('under useStrictMocks(), resolves no command dispatch refuses for a server-only flag, required or given', () => {
      useStrictMocks()

      expect([resolved('!pin hello'), resolved(`!pin hello --in=${CHANNEL}`), resolved(`!post hello --in=${CHANNEL}`)]).toEqual([
        undefined,
        undefined,
        undefined,
      ])
      expect(warned).toEqual([])
    })

    it('in default mode, still resolves such a command, and warns once that strict mocks resolve none', () => {
      expect([resolved('!pin hello'), resolved(`!pin hello --in=${CHANNEL}`), resolved(`!post hello --in=${CHANNEL}`)]).toEqual([
        'pin',
        'pin',
        'post',
      ])
      expect(warned).toEqual([
        'resolveRoute resolved a DM to Posts.pin, which dispatch answers "This command works in a server only.": a member, role or ' +
          'channel flag is found only in a server. Under useStrictMocks() this resolves to undefined.',
        'resolveRoute resolved a DM to Posts.post, which dispatch answers "This command works in a server only.": a member, role or ' +
          'channel flag is found only in a server. Under useStrictMocks() this resolves to undefined.',
      ])
    })
  })

  it("still refuses scope: 'dm' with an optional server-only flag at startup", () => {
    @Controller()
    class DmPosts {
      @MessageHandler('post {text...} {--in:channel?}', { scope: 'dm' })
      post() {}
    }
    @MeoCord({ controllers: [DmPosts], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class DmApp {}

    expect(() => MeoCordTestingModule.fromApp(DmApp).compile()).toThrow("scope is 'dm', but {--in:channel?} is found only in a server.")
  })
})
