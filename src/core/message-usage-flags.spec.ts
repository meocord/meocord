import 'reflect-metadata'
import { vi } from 'vitest'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const CHANNEL = '<#123456789012345678>'

// A usage reply names the required flags a message left out beside what its words lack, in one reply
describe('the usage reply to a message that leaves out a required flag and does not fit', () => {
  const ran: string[] = []

  @Controller()
  class Commands {
    @MessageHandler('pin {text...} {--in:channel}')
    pin() {
      ran.push('pin')
    }

    @MessageHandler('kick {who} {--reason:string}')
    kick() {
      ran.push('kick')
    }

    @MessageHandler('roll {a:int?} {b:int?} {--seed:int}')
    roll() {
      ran.push('roll')
    }

    @MessageHandler('dep --force {env} {--force:string}')
    dep() {
      ran.push('dep')
    }

    @MessageHandler('post {text...} {--in:channel?} {--loud}')
    post() {
      ran.push('post')
    }
  }

  @Controller()
  class Exact {
    @MessageHandler('tag {name} {--to:string}', { caseSensitive: true })
    tag() {
      ran.push('tag')
    }
  }

  @MeoCord({ controllers: [Commands, Exact], clientOptions: { intents: [] }, messages: { prefix: '!' } })
  class App {}

  async function replyTo(content: string) {
    ran.length = 0
    const message = createMockMessage({ content, guild: createMockGuild() })
    await MeoCordTestingModule.fromApp(App).compile().dispatch(message)
    const reply = (vi.mocked(message.reply as (...args: unknown[]) => unknown).mock.calls[0]?.[0] as { content?: string } | undefined)?.content
    return { ran: [...ran], reply }
  }

  it.each([
    ['!pin', 'Usage: !pin <text…> --in=<in>\ntext is missing\n--in is missing'],
    ['!kick a b', 'Usage: !kick <who> --reason=<reason>\nThe command has more words than it takes\n--reason is missing'],
    ['!roll x y', 'Usage: !roll [a] [b] --seed=<seed>\na: "x" is not a valid whole number\n--seed is missing'],
  ])('names the flag %j leaves out after what its words lack', async (content, reply) => {
    expect(await replyTo(content)).toEqual({ ran: [], reply })
  })

  it('names only what the words lack when the flag is given, in any case', async () => {
    expect(await replyTo(`!pin --in=${CHANNEL}`)).toEqual({ ran: [], reply: 'Usage: !pin <text…> --in=<in>\ntext is missing' })
    expect(await replyTo(`!pin --IN=${CHANNEL}`)).toEqual({ ran: [], reply: 'Usage: !pin <text…> --in=<in>\ntext is missing' })
  })

  it('names a flag given in another case on a case-sensitive command, which does not read it', async () => {
    expect(await replyTo('!tag --TO=x')).toEqual({ ran: [], reply: 'Usage: !tag <name> --to=<to>\nname is missing\n--to is missing' })
  })

  // A bare --force in the place of the pattern's own --force word is that word, and sets no flag
  it('names a flag whose name the message gave only as the pattern\'s own -- word', async () => {
    expect(await replyTo('!dep --force')).toEqual({ ran: [], reply: 'Usage: !dep --force <env> --force=<force>\nenv is missing\n--force is missing' })
    expect(await replyTo('!dep --force --force=x')).toEqual({ ran: [], reply: 'Usage: !dep --force <env> --force=<force>\nenv is missing' })
  })

  it('names no optional or untyped flag', async () => {
    expect(await replyTo('!post')).toEqual({ ran: [], reply: 'Usage: !post <text…> [--in=<in>] [--loud]\ntext is missing' })
  })
})
