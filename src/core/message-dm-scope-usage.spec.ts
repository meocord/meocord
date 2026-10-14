import 'reflect-metadata'
import { vi } from 'vitest'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const CHANNEL = '123456789012345678'
const SERVER_ONLY = 'This command works in a server only.'

// A DM to a command only a server has is told so first, whatever words it gives, as one whose words fit already is
describe('a DM to a server-only message command whose words do not fit', () => {
  const ran: string[] = []

  @Controller()
  class Commands {
    @MessageHandler('pin {text...} {--in:channel}')
    pin() {
      ran.push('pin')
    }

    @MessageHandler('kick {who:member} {reason...?}')
    kick() {
      ran.push('kick')
    }

    @MessageHandler('post {text...} {--in:channel?}')
    post() {
      ran.push('post')
    }
  }

  @MeoCord({ controllers: [Commands], clientOptions: { intents: [] }, messages: { prefix: '!' } })
  class App {}

  async function send(content: string, guild: ReturnType<typeof createMockGuild> | null) {
    ran.length = 0
    const message = createMockMessage({ content, guild })
    await MeoCordTestingModule.fromApp(App).compile().dispatch(message)
    return { ran: [...ran], reply: (vi.mocked(message.reply as (...args: unknown[]) => unknown).mock.calls[0]?.[0] as { content?: string } | undefined)?.content }
  }

  const inDm = (content: string) => send(content, null)

  it.each(['!pin', `!pin --in=${CHANNEL}`, '!kick', `!pin hello --in=${CHANNEL} --dry`])(
    'answers %j as server-only, as it answers the words that fit',
    async content => {
      expect(await inDm(content)).toEqual({ ran: [], reply: SERVER_ONLY })
    },
  )

  it('answers a DM that gives a server-only flag as server-only, in any case, though the command works in a DM', async () => {
    expect(await inDm(`!post --in=${CHANNEL}`)).toEqual({ ran: [], reply: SERVER_ONLY })
    expect(await inDm(`!post --IN=${CHANNEL}`)).toEqual({ ran: [], reply: SERVER_ONLY })
  })

  it('still answers a DM to a command that works there with the usage of what its words lack', async () => {
    expect(await inDm('!post')).toEqual({ ran: [], reply: 'Usage: !post <text…> [--in=<in>]\ntext is missing' })
  })

  it('still answers the words a message in a server lacks with the usage', async () => {
    expect(await send('!pin', createMockGuild())).toEqual({ ran: [], reply: 'Usage: !pin <text…> --in=<in>\ntext is missing\n--in is missing' })
    expect(await send('!kick', createMockGuild())).toEqual({ ran: [], reply: 'Usage: !kick <who> [reason…]\nwho is missing' })
  })

  // A command that a route also takes in a DM: that route's usage is the one a DM gets
  describe('beside a route of the same command that works in a DM', () => {
    @Controller()
    class Tags {
      @MessageHandler('tag {who:member}')
      byMember() {
        ran.push('byMember')
      }

      @MessageHandler('tag {name} {note}')
      byName() {
        ran.push('byName')
      }
    }

    @MeoCord({ controllers: [Tags], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class TagApp {}

    async function tag(content: string, guild: ReturnType<typeof createMockGuild> | null) {
      ran.length = 0
      const message = createMockMessage({ content, guild })
      await MeoCordTestingModule.fromApp(TagApp).compile().dispatch(message)
      return (vi.mocked(message.reply as (...args: unknown[]) => unknown).mock.calls[0]?.[0] as { content?: string } | undefined)?.content
    }

    it("answers a DM with the usage of the route that works there, and a server with the other's, as it did", async () => {
      expect(await tag('!tag', null)).toBe('Usage: !tag <name> <note>\nname is missing\nnote is missing')
      expect(await tag('!tag', createMockGuild())).toBe('Usage: !tag <who>\nwho is missing')
    })
  })
})
