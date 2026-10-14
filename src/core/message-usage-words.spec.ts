import 'reflect-metadata'
import { vi } from 'vitest'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createTranslator, defineCatalog } from '@src/common/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const TOO_MANY = 'The command has more words than it takes'

// A usage reply names the word a message left out or replaced, read word by word against the pattern
describe('the usage reply to a message that names a command without fitting it', () => {
  const ran: string[] = []

  @Controller()
  class Commands {
    @MessageHandler('ticket {id} close')
    close() {
      ran.push('close')
    }

    @MessageHandler('run {env} --now')
    run() {
      ran.push('run')
    }

    @MessageHandler('go {env} --now {--dry}')
    go() {
      ran.push('go')
    }

    @MessageHandler('move {from} to {dest}')
    move() {
      ran.push('move')
    }

    @MessageHandler('roll {a:int?} {b:int?}')
    roll() {
      ran.push('roll')
    }

    @MessageHandler('sort {order:asc|desc?} {n:int?}')
    sort() {
      ran.push('sort')
    }

    @MessageHandler('tail {r:role?} {n:int?}')
    tail() {
      ran.push('tail')
    }

    @MessageHandler('count {n:int} {a:int?} {b:int?}')
    count() {
      ran.push('count')
    }

    @MessageHandler('rest {words...}')
    rest() {
      ran.push('rest')
    }
  }

  @Controller()
  class Exact {
    @MessageHandler('walk {env} Now', { caseSensitive: true })
    walk() {
      ran.push('walk')
    }
  }

  @MeoCord({ controllers: [Commands, Exact], clientOptions: { intents: [] }, messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })
  class App {}

  async function replyTo(content: string, app: new () => unknown = App, guild = createMockGuild()) {
    ran.length = 0
    const message = createMockMessage({ content, guild })
    await MeoCordTestingModule.fromApp(app).compile().dispatch(message)
    const reply = (vi.mocked(message.reply).mock.calls[0]?.[0] as { content?: string } | undefined)?.content
    return { ran: [...ran], reply }
  }

  it.each([
    ['!ticket 5', 'Usage: !ticket <id> close\nclose is missing'],
    ['!ticket 5 open', 'Usage: !ticket <id> close\nclose is missing'],
    ['!ticket', 'Usage: !ticket <id> close\nid is missing\nclose is missing'],
    ['!run prod', 'Usage: !run <env> --now\n--now is missing'],
    ['!run prod x', 'Usage: !run <env> --now\n--now is missing'],
    ['!go prod --dry', 'Usage: !go <env> --now [--dry]\n--now is missing'],
    ['!move a b', 'Usage: !move <from> to <dest>\nto is missing'],
    ['!walk prod now', 'Usage: !walk <env> Now\nNow is missing'],
  ])('names the word %j left out or replaced', async (content, reply) => {
    expect(await replyTo(content)).toEqual({ ran: [], reply })
  })

  it.each([
    ['!ticket 5 close extra', 'Usage: !ticket <id> close'],
    ['!go prod --now extra', 'Usage: !go <env> --now [--dry]'],
    ['!roll 1 2 3', 'Usage: !roll [a] [b]'],
    ['!roll x y z', 'Usage: !roll [a] [b]'],
  ])('says %j has more words than the pattern takes', async (content, usage) => {
    expect(await replyTo(content)).toEqual({ ran: [], reply: `${usage}\n${TOO_MANY}` })
  })

  it.each([
    ['!roll x y', 'Usage: !roll [a] [b]\na: "x" is not a valid whole number'],
    ['!sort up 3', 'Usage: !sort [order] [n]\norder: "up" is not one of asc, desc'],
    ['!count q x y', 'Usage: !count <n> [a] [b]\nn: "q" is not a valid whole number'],
  ])('names the first word in %j that its param does not take', async (content, reply) => {
    expect(await replyTo(content)).toEqual({ ran: [], reply })
  })

  // A role is also found by its name, so a word is named as not a role only when it names none of the server's roles
  describe('beside a role param', () => {
    const MODS = '100000000000000011'
    const withMods = () => createMockGuild({ roles: [{ id: MODS, name: 'Mods' } as never] })

    it.each([
      ['!tail Mods 3', 'Usage: !tail [r] [n]\nr: "Mods" is not a valid role'],
      ['!tail 3 Mods', 'Usage: !tail [r] [n]\nr: "3" is not a valid role'],
    ])('names a word for %j that names no role of the server', async (content, reply) => {
      expect(await replyTo(content, App, createMockGuild())).toEqual({ ran: [], reply })
    })

    // The matcher takes only a mention or an ID before another param, which no text says, so the usage stands alone
    it.each(['!tail Mods 3', '!tail mods 3'])('answers %j with the usage alone, in a server with a role named Mods', async content => {
      expect(await replyTo(content, App, withMods())).toEqual({ ran: [], reply: 'Usage: !tail [r] [n]' })
    })

    it.each([
      ['!tail Mods x', 'Usage: !tail [r] [n]\nn: "x" is not a valid whole number'],
      ['!tail 3 Mods', 'Usage: !tail [r] [n]\nr: "3" is not a valid role'],
    ])('names the first word in %j that its param does not take, in a server with a role named Mods', async (content, reply) => {
      expect(await replyTo(content, App, withMods())).toEqual({ ran: [], reply })
    })
  })

  // A word the last optional param takes is read by its type, as before
  it('names the param a single word goes to, as it did', async () => {
    expect(await replyTo('!roll x')).toEqual({ ran: [], reply: 'Usage: !roll [a] [b]\nb: "x" is not a valid whole number' })
  })

  it('still names a required param left out, and runs a message that fits', async () => {
    expect(await replyTo('!rest')).toEqual({ ran: [], reply: 'Usage: !rest <words…>\nwords is missing' })
    expect((await replyTo('!ticket 5 close')).ran).toEqual(['close'])
    expect((await replyTo('!go prod --now --dry')).ran).toEqual(['go'])
    expect((await replyTo('!walk prod Now')).ran).toEqual(['walk'])
  })

  it('answers the same through invoke', async () => {
    const message = createMockMessage({ content: '!ticket 5', guild: createMockGuild() })

    await expect(MeoCordTestingModule.fromApp(App).compile().invoke(Commands, 'close', message)).rejects.toThrow(
      'Usage: !ticket <id> close\nclose is missing',
    )
  })

  // The reply is MeoCord's existing texts, so a catalog that translated them all translates it too
  it("is translated by a catalog of MeoCord's existing texts", async () => {
    const i18n = createTranslator({
      default: 'en-US',
      locales: {
        'en-US': defineCatalog({}),
        id: {
          meocord: {
            usage: { heading: 'Cara pakai: {usage}', missing: '{param} belum diisi', notValid: '{label}: "{word}" bukan {type} yang sah' },
            types: { int: 'bilangan bulat' },
          },
        },
      },
    })
    @MeoCord({ controllers: [Commands], i18n, clientOptions: { intents: [] }, messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })
    class Translated {}
    const guild = Object.assign(createMockGuild(), { preferredLocale: 'id' })

    expect((await replyTo('!ticket 5', Translated, guild)).reply).toBe('Cara pakai: !ticket <id> close\nclose belum diisi')
    expect((await replyTo('!roll x y', Translated, guild)).reply).toBe('Cara pakai: !roll [a] [b]\na: "x" bukan bilangan bulat yang sah')
    const withMods = Object.assign(createMockGuild({ roles: [{ id: '100000000000000011', name: 'Mods' } as never] }), { preferredLocale: 'id' })
    expect((await replyTo('!tail Mods 3', Translated, withMods)).reply).toBe('Cara pakai: !tail [r] [n]')
  })
})
