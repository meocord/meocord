import 'reflect-metadata'
import { type Message, type User } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const USER = '100000000000000042'

// A message param named like an Object.prototype member is a key like any other, as #510 made interaction options
describe('a message param named like an Object member', () => {
  const ran: Record<string, unknown>[] = []
  const record = (params: Record<string, unknown>) => void ran.push(params)

  @Controller()
  class Words {
    @MessageHandler('a {__proto__}')
    a(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('b {__proto__:int...}')
    b(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('c {__proto__:int}')
    c(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('d {n:int} {constructor:int?}')
    d(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('t {n:int} {toString:int?}')
    t(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('e {name} {toString?}')
    e(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('f {n:int} {--constructor:int?} {--toString}')
    f(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('u {__proto__:user}')
    u(_message: Message, params: Record<string, unknown>) {
      record(params)
    }

    @MessageHandler('g {name} {nick?}')
    g(_message: Message, params: Record<string, unknown>) {
      record(params)
    }
  }

  @MeoCord({ controllers: [Words], clientOptions: { intents: [] }, messages: { prefix: '!' } })
  class App {}

  async function paramsFor(content: string, users: User[] = []) {
    ran.length = 0
    const message = createMockMessage({ content, guild: createMockGuild(), users })
    await MeoCordTestingModule.fromApp(App).compile().dispatch(message)
    expect(ran).toHaveLength(1)
    return ran[0]
  }

  const own = (params: Record<string, unknown>) => Object.fromEntries(Object.keys(params).map(key => [key, params[key]]))

  // An object literal's __proto__ sets its prototype, so each expected value is built as an own key
  it.each([
    ['!a hello', 'hello'],
    ['!b 1 2', [1, 2]],
    ['!c 5', 5],
  ])('keys %j by its own __proto__, with a plain prototype', async (content, value) => {
    const params = await paramsFor(content)

    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.keys(params)).toEqual(['__proto__'])
    expect(own(params)).toEqual(Object.fromEntries([['__proto__', value]]))
  })

  it.each([
    ['!d 1 2', { n: 1, constructor: 2 }],
    ['!d 1', { n: 1, constructor: undefined }],
    ['!t 1 2', { n: 1, toString: 2 }],
    ['!t 1', { n: 1, toString: undefined }],
    ['!e ana x', { name: 'ana', toString: 'x' }],
    ['!e ana', { name: 'ana', toString: undefined }],
  ])('gives %j its value, or an own undefined when left out', async (content, expected) => {
    const params = await paramsFor(content)

    for (const [key, value] of Object.entries(expected)) {
      expect(Object.hasOwn(params, key)).toBe(true)
      expect(params[key]).toBe(value)
    }
  })

  it('gives flags named like Object members their values, or false and an own undefined when left out', async () => {
    const given = await paramsFor('!f 1 --constructor=2 --toString')
    const left = await paramsFor('!f 1')

    expect([given.constructor, given.toString]).toEqual([2, true])
    expect(Object.hasOwn(left, 'constructor')).toBe(true)
    expect([left.constructor, left.toString]).toEqual([undefined, false])
  })

  it('keys a resolved user by its own __proto__', async () => {
    const user = { id: USER } as User
    const params = await paramsFor(`!u <@${USER}>`, [user])

    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(Object.hasOwn(params, '__proto__')).toBe(true)
    expect(params.__proto__).toBe(user)
  })

  it('still leaves an ordinary optional param out of the keys', async () => {
    expect(await paramsFor('!g ana')).toStrictEqual({ name: 'ana' })
  })

  it('reads the same through invoke', async () => {
    ran.length = 0
    const module = MeoCordTestingModule.fromApp(App).compile()
    await module.invoke(Words, 'd', createMockMessage({ content: '!d 1', guild: createMockGuild() }))
    await module.invoke(Words, 'a', createMockMessage({ content: '!a hello', guild: createMockGuild() }))

    expect(Object.hasOwn(ran[0], 'constructor')).toBe(true)
    expect(ran[0].constructor).toBeUndefined()
    expect(Object.hasOwn(ran[1], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(ran[1])).toBe(Object.prototype)
  })
})
