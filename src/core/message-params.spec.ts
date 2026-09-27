import { Collection, type GuildMember, type Role, type TextChannel, type User } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { MessageUsageError } from '@src/common/errors.js'
import { type MessageParamType } from '@src/interface/index.js'
import { buildMessageRoutes, matchMessageRoute, type MessageRoute } from '@src/core/message-routes.js'
import { fitsParamType, missingParams, resolveMessageParams, usageOf } from '@src/core/message-params.js'
import { createMockGuild, createMockMessage } from '@src/testing/index.js'

const ID = (n: number) => String(100_000_000_000_000_000n + BigInt(n))

/** The route for one pattern, as dispatch builds it. */
function routeOf(pattern: string, types?: Record<string, MessageParamType>): MessageRoute {
  @Controller()
  class Only {
    @MessageHandler(pattern)
    handle() {}
  }
  return buildMessageRoutes([Only], { types })[0]
}

/** A message in a guild whose caches hold these members, roles and channels, and whose fetches are recorded. */
function guildMessage(cached: { members?: GuildMember[]; roles?: Role[]; channels?: TextChannel[] } = {}) {
  const guild = createMockGuild(cached)
  const message = createMockMessage({ content: 'x', guild })
  return { message, guild }
}

const member = (id: string) => ({ id, user: { id } }) as unknown as GuildMember

async function usageError(promise: Promise<unknown>): Promise<MessageUsageError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(MessageUsageError)
  return error as MessageUsageError
}

describe('typed message params', () => {
  it('turns words into numbers, booleans, durations and choices', async () => {
    const route = routeOf('set {count:int} {ratio:number} {on:bool} {after:duration} {mode:fast|Slow}')
    const { message } = guildMessage()
    const raw = { count: '-3', ratio: '2.5', on: 'Yes', after: '2h30m', mode: 'slow' }

    expect(await resolveMessageParams(route, raw, message, '!', undefined)).toEqual({
      count: -3,
      ratio: 2.5,
      on: true,
      after: 9_000_000,
      mode: 'Slow',
    })
  })

  it('names every word that is not a value of its type, with the usage', async () => {
    const route = routeOf('set {count:int} {after:duration} {mode:fast|slow}')
    const { message } = guildMessage()

    const error = await usageError(resolveMessageParams(route, { count: '2.5', after: 'soon', mode: 'turbo' }, message, '!', undefined))

    expect(error.usage).toBe('!set <count> <after> <mode>')
    expect(error.issues).toEqual([
      { param: 'count', message: 'count: "2.5" is not a valid whole number' },
      { param: 'after', message: 'after: "soon" is not a valid length of time, such as 10m' },
      { param: 'mode', message: 'mode: "turbo" is not one of fast, slow' },
    ])
    expect(error.message).toBe(
      'Usage: !set <count> <after> <mode>\ncount: "2.5" is not a valid whole number\nafter: "soon" is not a valid length of time, such as 10m\nmode: "turbo" is not one of fast, slow',
    )
  })

  it("uses an app's own type, and its label in the issue", async () => {
    const color: MessageParamType<number> = {
      label: 'hex colour',
      parse: word => (/^#[0-9a-f]{6}$/i.test(word) ? parseInt(word.slice(1), 16) : undefined),
    }
    const route = routeOf('paint {shade:color}', { color })
    const { message } = guildMessage()

    expect(await resolveMessageParams(route, { shade: '#ff0000' }, message, '!', { color })).toEqual({ shade: 0xff0000 })
    const error = await usageError(resolveMessageParams(route, { shade: 'red' }, message, '!', { color }))
    expect(error.issues).toEqual([{ param: 'shade', message: 'shade: "red" is not a valid hex colour' }])
  })

  it('reads right for a label that begins with a vowel, and for a built-in type', async () => {
    const emoji: MessageParamType<string> = { label: 'emoji', parse: word => (/^\p{Extended_Pictographic}$/u.test(word) ? word : undefined) }
    const route = routeOf('react {with:emoji} {times:int}', { emoji })
    const { message } = guildMessage()

    const error = await usageError(resolveMessageParams(route, { with: 'smile', times: 'twice' }, message, '!', { emoji }))
    expect(error.issues).toEqual([
      { param: 'with', message: 'with: "smile" is not a valid emoji' },
      { param: 'times', message: 'times: "twice" is not a valid whole number' },
    ])
  })

  it('finds members by mention or ID in the cache, fetching nothing', async () => {
    const [a, b] = [member(ID(1)), member(ID(2))]
    const { message, guild } = guildMessage({ members: [a, b] })
    const route = routeOf('pair {first:member} {second:member}')

    const params = await resolveMessageParams(route, { first: `<@!${ID(1)}>`, second: ID(2) }, message, '!', undefined)

    expect(params).toEqual({ first: a, second: b })
    expect(guild.members.fetch).not.toHaveBeenCalled()
  })

  it('fetches the members the cache lacks together, in one request', async () => {
    const { message, guild } = guildMessage({ members: [member(ID(1))] })
    const [b, c] = [member(ID(2)), member(ID(3))]
    guild.members.fetch.mockResolvedValue(new Collection([[ID(2), b], [ID(3), c]]) as never)
    const route = routeOf('trio {a:member} {b:member} {c:member}')

    const params = await resolveMessageParams(route, { a: ID(1), b: ID(2), c: `<@${ID(3)}>` }, message, '!', undefined)

    expect(params).toEqual({ a: member(ID(1)), b, c })
    expect(guild.members.fetch).toHaveBeenCalledTimes(1)
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: [ID(2), ID(3)] })
  })

  it('asks for uncached members at most 100 at a time, as a gateway request takes no more', async () => {
    const { message, guild } = guildMessage()
    const ids = Array.from({ length: 150 }, (_, i) => ID(200 + i))
    guild.members.fetch.mockImplementation((async ({ user }: { user: string[] }) => new Collection(user.map(id => [id, member(id)]))) as never)

    const params = await resolveMessageParams(routeOf('kick {targets:member...}'), { targets: ids.join(' ') }, message, '!', undefined)

    expect((params.targets as GuildMember[]).map(target => target.id)).toEqual(ids)
    expect(guild.members.fetch.mock.calls.map(([options]) => (options as { user: string[] }).user.length)).toEqual([100, 50])
  })

  it('fetches one uncached member on its own, and fetches each when the batch is refused', async () => {
    const one = guildMessage()
    one.guild.members.fetch.mockResolvedValue(member(ID(5)) as never)
    await resolveMessageParams(routeOf('who {m:member}'), { m: ID(5) }, one.message, '!', undefined)
    expect(one.guild.members.fetch).toHaveBeenCalledWith(ID(5))

    const two = guildMessage()
    two.guild.members.fetch.mockImplementation((async (options: unknown) => {
      if (typeof options === 'object') throw new Error('Members intent missing')
      return member(options as string)
    }) as never)
    const params = await resolveMessageParams(routeOf('pair {a:member} {b:member}'), { a: ID(6), b: ID(7) }, two.message, '!', undefined)
    expect(params).toEqual({ a: member(ID(6)), b: member(ID(7)) })
    expect(two.guild.members.fetch).toHaveBeenCalledTimes(3)
  })

  it('names an ID that is no member of the server', async () => {
    const { message, guild } = guildMessage()
    guild.members.fetch.mockRejectedValue(new Error('Unknown Member'))

    const error = await usageError(resolveMessageParams(routeOf('kick {m:member}'), { m: ID(8) }, message, '!', undefined))

    expect(error.issues).toEqual([{ param: 'm', message: `m: <@${ID(8)}> is not a member of this server` }])
  })

  it('finds roles by mention, ID or name, and channels by mention or ID', async () => {
    const role = { id: ID(10), name: 'Moderator' } as unknown as Role
    const channel = { id: ID(20) } as unknown as TextChannel
    const { message } = guildMessage({ roles: [role], channels: [channel] })
    const route = routeOf('grant {r:role} {c:channel}')

    for (const r of [`<@&${ID(10)}>`, ID(10), 'moderator']) {
      expect(await resolveMessageParams(route, { r, c: `<#${ID(20)}>` }, message, '!', undefined)).toEqual({ r: role, c: channel })
    }
  })

  it('resolves a user from the client cache, or fetches it', async () => {
    const [cached, fetched] = [{ id: ID(30) }, { id: ID(31) }] as unknown as User[]
    const message = createMockMessage({ content: 'x', guild: createMockGuild(), users: [cached] })
    const users = vi.mocked(message.client.users)
    users.fetch.mockResolvedValue(fetched as never)
    const route = routeOf('who {u:user}')

    expect(await resolveMessageParams(route, { u: `<@${ID(30)}>` }, message, '!', undefined)).toEqual({ u: cached })
    expect(users.fetch).not.toHaveBeenCalled()
    expect(await resolveMessageParams(route, { u: ID(31) }, message, '!', undefined)).toEqual({ u: fetched })
    expect(users.fetch).toHaveBeenCalledWith(ID(31))
  })

  it('says a command with a member, role or channel param works in a server only, sent in a DM', async () => {
    const message = createMockMessage({ content: '!kick x', guild: null })
    const error = await usageError(resolveMessageParams(routeOf('kick {m:member}'), { m: ID(1) }, message, '!', undefined))

    expect(error.serverOnly).toBe(true)
    expect(error.message).toBe('This command works in a server only.')
  })

  it('marks an error quiet when the message used no prefix or mention', async () => {
    const error = await usageError(resolveMessageParams(routeOf('roll {n:int}'), { n: 'dice' }, guildMessage().message, '', undefined))
    expect(error.quiet).toBe(true)
  })

  it('leaves a route with no typed param as it was matched', async () => {
    const raw = { text: 'hello' }
    expect(await resolveMessageParams(routeOf('say {text...}'), raw, guildMessage().message, '!', undefined)).toBe(raw)
  })
})

describe('the form of a typed word', () => {
  it('tells from the word alone whether it can be a value of a built-in type', () => {
    expect(['20', '-3'].map(word => fitsParamType('int', word, false))).toEqual([true, true])
    expect(['2.5', 'x'].map(word => fitsParamType('int', word, false))).toEqual([false, false])
    expect(['2.5', 'yes', 'OFF', '1h30m', 'soon'].map((word, i) => fitsParamType(['number', 'bool', 'bool', 'duration', 'duration'][i], word, false))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ])
    expect([`<@${ID(1)}>`, `<@!${ID(1)}>`, ID(1), 'ana'].map(word => fitsParamType('member', word, false))).toEqual([true, true, true, false])
    expect([`<@&${ID(1)}>`, ID(1), 'Moderator'].map(word => fitsParamType('role', word, false))).toEqual([true, true, false])
    expect([`<#${ID(1)}>`, `<@${ID(1)}>`].map(word => fitsParamType('channel', word, false))).toEqual([true, false])
    expect([fitsParamType('on|off', 'ON', false), fitsParamType('on|off', 'ON', true)]).toEqual([true, false])
  })
})

describe('typed lists', () => {
  it('turns each word of a typed rest into a value, quoted words as one', async () => {
    const route = routeOf('poll {question} {options:string...}')
    expect(await resolveMessageParams(route, { question: 'Lunch?', options: 'pizza "fried rice" soup' }, guildMessage().message, '!', undefined)).toEqual({
      question: 'Lunch?',
      options: ['pizza', 'fried rice', 'soup'],
    })
  })

  it('names each item that is not a value of its type', async () => {
    const route = routeOf('sum {numbers:int...}')
    const error = await usageError(resolveMessageParams(route, { numbers: '1 two 3 four' }, guildMessage().message, '!', undefined))
    expect(error.issues).toEqual([
      { param: 'numbers', message: 'numbers: "two" is not a valid whole number' },
      { param: 'numbers', message: 'numbers: "four" is not a valid whole number' },
    ])
  })

  it('fetches the uncached members of a list together with the other params, in one request', async () => {
    const { message, guild } = guildMessage({ members: [member(ID(1))] })
    guild.members.fetch.mockResolvedValue(new Collection([[ID(2), member(ID(2))], [ID(3), member(ID(3))]]) as never)
    const route = routeOf('kick {first:member} {rest:member...}')

    const params = await resolveMessageParams(route, { first: ID(3), rest: `<@${ID(1)}> ${ID(2)}` }, message, '!', undefined)

    expect(params).toEqual({ first: member(ID(3)), rest: [member(ID(1)), member(ID(2))] })
    expect(guild.members.fetch).toHaveBeenCalledTimes(1)
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: [ID(3), ID(2)] })
  })
})

describe('flags', () => {
  const flagged = (content: string, pattern = 'purge {count:int} {--bots} {--from:member?} {--limit:int?}', guild = createMockGuild()) => {
    const route = routeOf(pattern)
    const message = createMockMessage({ content, guild })
    const matched = matchMessageRoute([route], content, { prefixes: ['!'] })
    return { route, message, matched, resolve: () => resolveMessageParams(route, matched!.params, message, matched!.start, undefined) }
  }

  it('turns a flag without a type into true or false, and a typed one into its value', async () => {
    expect(await flagged('!purge --bots 50').resolve()).toEqual({ count: 50, bots: true })
    expect(await flagged('!purge 50').resolve()).toEqual({ count: 50, bots: false })
    expect(await flagged('!purge 50 --bots=no --limit=10').resolve()).toEqual({ count: 50, bots: false, limit: 10 })
    expect(await flagged('!purge 50 --LIMIT=1 --limit=2').resolve()).toEqual({ count: 50, bots: false, limit: 2 })
  })

  it('names a flag the command does not have, one missing its value, and a value that is not of its type', async () => {
    const error = await usageError(flagged('!purge 50 --bot --from --limit=lots --bots=maybe --bot').resolve())
    expect(error.usage).toBe('!purge <count> [--bots] [--from=<from>] [--limit=<limit>]')
    expect(error.issues).toEqual([
      { param: 'limit', message: '--limit: "lots" is not a valid whole number' },
      { message: '--bot is not an option of this command' },
      { param: 'bots', message: '--bots: "maybe" is not yes or no' },
      { param: 'from', message: '--from needs a value, such as --from=<from>' },
    ])
  })

  it('names a required flag left out', async () => {
    const error = await usageError(flagged('!remind 10m', 'remind {after:duration} {--note:string}').resolve())
    expect(error.issues).toEqual([{ param: 'note', message: '--note is missing' }])
    expect(await flagged('!remind 10m --note="buy milk"', 'remind {after:duration} {--note:string}').resolve()).toEqual({
      after: 600_000,
      note: 'buy milk',
    })
  })

  it('fetches an uncached member flag together with uncached member params, in one request, and needs a server only for a flag given', async () => {
    const guild = createMockGuild()
    guild.members.fetch.mockResolvedValue(new Collection([[ID(4), member(ID(4))], [ID(5), member(ID(5))]]) as never)
    // Bare ids: a mention would arrive cached with the message, as the gateway delivers it
    const { resolve } = flagged(`!warn ${ID(4)} --by=${ID(5)}`, 'warn {target:member} {--by:member?}', guild)

    expect(await resolve()).toEqual({ target: member(ID(4)), by: member(ID(5)) })
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: [ID(4), ID(5)] })
    expect(await flagged('!purge 5', undefined, null as never).resolve()).toEqual({ count: 5, bots: false })
    const dm = await usageError(flagged(`!purge 5 --from=${ID(4)}`, undefined, null as never).resolve())
    expect(dm.serverOnly).toBe(true)
  })
})

describe('usage', () => {
  it('shows a route as the user types it, after the start the message used', () => {
    const route = routeOf('ban {target:member} {days:int} {reason...?}')
    expect(usageOf(route, '!')).toBe('!ban <target> <days> [reason…]')
    expect(usageOf(route, '<@111> ')).toBe('<@111> ban <target> <days> [reason…]')
  })

  it('names the required params a command left out, or says it has too many words', () => {
    const route = routeOf('pay {to:member} {amount:int} {note...?}')
    expect(missingParams(route, 0)).toEqual([
      { param: 'to', message: 'to is missing' },
      { param: 'amount', message: 'amount is missing' },
    ])
    expect(missingParams(route, 1)).toEqual([{ param: 'amount', message: 'amount is missing' }])
    expect(missingParams(routeOf('ping'), 2)).toEqual([{ message: 'The command has more words than it takes' }])
  })
})

describe('typed patterns at startup', () => {
  it('refuses a type no one declared, for a param or a flag', () => {
    expect(() => routeOf('pay {amount:money}')).toThrow(/\{amount:money\} names no type/)
    expect(() => routeOf('pay {amount:int} {--fee:money?}')).toThrow(/\{--fee:money\} names no type/)
  })

  it("refuses an app's own type before another optional param, since only its parse can tell its words", () => {
    const color: MessageParamType<number> = { parse: word => (word.startsWith('#') ? 1 : undefined) }
    expect(() => routeOf('paint {shade:color?} {note...?}', { color })).toThrow(/\{shade:color\?\} comes before another optional param/)
    expect(() => routeOf('paint {note:int?} {shade:color?}', { color })).not.toThrow()
  })

  it("refuses an app type named like a built-in, one without parse, and a usage reply time that isn't one", () => {
    const declare = (messages: object) => () => MeoCord({ controllers: [], clientOptions: { intents: [] }, messages })(class App {})
    expect(declare({ types: { int: { parse: () => 1 } } })).toThrow('"int" is a built-in type')
    expect(declare({ types: { color: {} } })).toThrow('"color" needs a parse(word, message) function')
    expect(declare({ deleteUsageRepliesAfter: -1 })).toThrow('takes a number of seconds, or 0')
    expect(declare({ deleteUsageRepliesAfter: 0, types: { color: { parse: () => 1 } } })).not.toThrow()
  })
})

