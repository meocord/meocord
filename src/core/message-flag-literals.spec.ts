import 'reflect-metadata'
import { vi } from 'vitest'
import { type Message } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule, resolveRoute } from '@src/testing/index.js'

// A pattern's own word that starts with `--`, in a pattern with flags, is matched where the pattern has it, given bare
describe("a pattern's own -- word, beside flags", () => {
  const ran: [string, unknown][] = []

  @Controller()
  class Ops {
    @MessageHandler('deploy --force {env} {--dry}')
    deploy(_message: Message, params: unknown) {
      ran.push(['deploy', params])
    }

    @MessageHandler('build {x} {--force}')
    build(_message: Message, params: unknown) {
      ran.push(['build', params])
    }
  }

  @MeoCord({ controllers: [Ops], clientOptions: { intents: [] }, messages: { prefix: '!' } })
  class App {}

  @Controller()
  class Exact {
    @MessageHandler('deploy --force {env} {--dry}', { caseSensitive: true })
    deploy(_message: Message, params: unknown) {
      ran.push(['deploy', params])
    }
  }

  @MeoCord({ controllers: [Exact], clientOptions: { intents: [] }, messages: { prefix: '!' } })
  class ExactApp {}

  async function send(content: string, app: new () => unknown = App) {
    ran.length = 0
    const message = createMockMessage({ content, guild: createMockGuild() })
    await MeoCordTestingModule.fromApp(app).compile().dispatch(message)
    return { ran: [...ran], reply: (vi.mocked(message.reply).mock.calls[0]?.[0] as { content?: string } | undefined)?.content }
  }

  it.each([
    ['!deploy --force prod', { env: 'prod', dry: false }],
    ['!deploy --force prod --dry', { env: 'prod', dry: true }],
    ['!deploy --dry --force prod', { env: 'prod', dry: true }],
    ['!deploy --FORCE prod', { env: 'prod', dry: false }],
    ['!deploy "--force" prod', { env: 'prod', dry: false }],
  ])('runs for %j, typed as its usage shows', async (content, params) => {
    expect(await send(content)).toEqual({ ran: [['deploy', params]], reply: undefined })
  })

  it('matches the word in the case written on a case-sensitive command', async () => {
    expect((await send('!deploy --FORCE prod', ExactApp)).ran).toEqual([])
    expect((await send('!deploy --force prod', ExactApp)).ran).toEqual([['deploy', { env: 'prod', dry: false }]])
  })

  it.each(['!deploy prod --force', '!deploy --force=yes prod'])('runs nothing for %j, with the word out of place or given a value', async content => {
    const { ran: handlers, reply } = await send(content)

    expect(handlers).toEqual([])
    expect(reply).toMatch(/^Usage: !deploy --force <env> \[--dry\]/)
  })

  it('says what is missing when the word is given and nothing after it', async () => {
    expect(await send('!deploy --force')).toEqual({ ran: [], reply: 'Usage: !deploy --force <env> [--dry]\nenv is missing' })
  })

  it('gives another route of the app that declares {--force} the flag', async () => {
    expect(await send('!build x --force')).toEqual({ ran: [['build', { x: 'x', force: true }]], reply: undefined })
  })

  // The word is taken only where the pattern has it and only bare, so another route of the command keeps the flag
  describe('beside a route of the same command that declares the flag', () => {
    @Controller()
    class Both {
      @MessageHandler('deploy --force {env} {--dry}')
      deploy(_message: Message, params: unknown) {
        ran.push(['deploy', params])
      }

      @MessageHandler('deploy {env} {--force:string?}')
      tagged(_message: Message, params: unknown) {
        ran.push(['tagged', params])
      }
    }

    @MeoCord({ controllers: [Both], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class BothApp {}

    it.each([
      ['!deploy --force prod', [['deploy', { env: 'prod', dry: false }]]],
      ['!deploy --force=yes prod', [['tagged', { env: 'prod', force: 'yes' }]]],
      ['!deploy prod --force=yes', [['tagged', { env: 'prod', force: 'yes' }]]],
    ])('gives %j to the route whose words it is', async (content, handlers) => {
      expect((await send(content, BothApp)).ran).toEqual(handlers)
    })

    it('takes a bare --force out of place as the flag, which wants a value', async () => {
      expect(await send('!deploy prod --force', BothApp)).toEqual({ ran: [], reply: 'Usage: !deploy <env> [--force=<force>]\n--force needs a value, such as --force=<force>' })
    })
  })

  // A pattern's first word can be its own -- word, which a message gives first, bare
  it('runs a pattern that begins with its own -- word', async () => {
    @Controller()
    class Leading {
      @MessageHandler('--force {x} {--dry}')
      force(_message: Message, params: unknown) {
        ran.push(['force', params])
      }
    }

    @MeoCord({ controllers: [Leading], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class LeadingApp {}

    expect(await send('!--force a', LeadingApp)).toEqual({ ran: [['force', { x: 'a', dry: false }]], reply: undefined })
    expect(await send('!--force a --dry', LeadingApp)).toEqual({ ran: [['force', { x: 'a', dry: true }]], reply: undefined })
    expect(await send('!--force', LeadingApp)).toEqual({ ran: [], reply: 'Usage: !--force <x> [--dry]\nx is missing' })
  })

  it('resolves to the route, as dispatch runs it', () => {
    expect(resolveRoute(App, { content: '!deploy --force prod' })).toMatchObject({ method: 'deploy', params: { env: 'prod' } })
  })
})
