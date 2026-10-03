import { Collection, type GuildMember, type Role, type TextChannel, type User } from 'discord.js'
import { Controller, MessageHandler } from '@src/decorator/index.js'
import { MessageUsageError } from '@src/common/errors.js'
import { type EntityRef, type MessageParamType } from '@src/interface/index.js'
import { buildMessageRoutes, type MessageRoute } from '@src/core/message-routes.js'
import { fetchMessageParams, parseMessageParams } from '@src/core/message-params.js'
import { createMockGuild, createMockMessage } from '@src/testing/index.js'

const ID = (n: number) => String(100_000_000_000_000_000n + BigInt(n))
const ids = (count: number, from = 0) => Array.from({ length: count }, (_, i) => ID(from + i))
const member = (id: string) => ({ id, user: { id } }) as unknown as GuildMember

function routeOf(pattern: string, types?: Record<string, MessageParamType>): MessageRoute {
  @Controller()
  class Only {
    @MessageHandler(pattern)
    handle() {}
  }
  return buildMessageRoutes([Only], { types })[0]
}

/** A message in a guild with nothing cached, whose fetches are recorded. */
function fresh() {
  const guild = createMockGuild()
  const message = createMockMessage({ content: 'x', guild })
  return { message, guild, users: vi.mocked(message.client.users) }
}

describe('reading entity params before the guards', () => {
  it('fetches nothing for 50 uncached members, users or channels, and gives refs with their IDs', async () => {
    const { message, guild, users } = fresh()
    const fifty = ids(50)

    for (const pattern of ['kick {targets:member...}', 'whois {targets:user...}', 'lock {targets:channel...}']) {
      const parsed = await parseMessageParams(routeOf(pattern), { targets: fifty.join(' ') }, message, '!', undefined)
      const refs = parsed.params.targets as EntityRef<unknown>[]
      expect(refs.map(ref => ref.id)).toEqual(fifty)
      expect(refs.every(ref => ref.cached === undefined)).toBe(true)
    }
    expect(guild.members.fetch).not.toHaveBeenCalled()
    expect(users.fetch).not.toHaveBeenCalled()
    expect(guild.channels.fetch).not.toHaveBeenCalled()
  })

  it('fills a ref from the cache, so a mentioned or cached member needs no request at all', async () => {
    const cached = member(ID(1))
    const guild = createMockGuild({ members: [cached] })
    const message = createMockMessage({ content: 'x', guild })

    const parsed = await parseMessageParams(routeOf('kick {target:member}'), { target: `<@${ID(1)}>` }, message, '!', undefined)
    const checkCooldowns = vi.fn(async () => {})

    expect((parsed.params.target as EntityRef<GuildMember>).cached).toBe(cached)
    expect(await fetchMessageParams(parsed, checkCooldowns)).toEqual({ target: cached })
    expect(checkCooldowns).not.toHaveBeenCalled()
    expect(guild.members.fetch).not.toHaveBeenCalled()
  })

  it('still refuses a word that is no ID, before any guard, with no request', async () => {
    const { message, users } = fresh()
    await expect(parseMessageParams(routeOf('whois {target:user}'), { target: 'ana' }, message, '!', undefined)).rejects.toThrow(
      'target: "ana" is not a valid user',
    )
    expect(users.fetch).not.toHaveBeenCalled()
  })
})

describe('fetching entity params after the guards', () => {
  it('checks the cooldowns first when there is something to fetch, and fetches nothing when they refuse', async () => {
    const { message, users } = fresh()
    const parsed = await parseMessageParams(routeOf('whois {target:user}'), { target: ID(7) }, message, '!', undefined)

    await expect(fetchMessageParams(parsed, async () => Promise.reject(new Error('cooling down')))).rejects.toThrow('cooling down')
    expect(users.fetch).not.toHaveBeenCalled()
  })

  it("shares one request between a guard's resolve() and the fetch after it", async () => {
    const { message, users } = fresh()
    const user = { id: ID(8) } as User
    users.fetch.mockResolvedValue(user as never)
    const parsed = await parseMessageParams(routeOf('whois {target:user}'), { target: ID(8) }, message, '!', undefined)

    const [inGuard, after] = await Promise.all([(parsed.params.target as EntityRef<User>).resolve(), fetchMessageParams(parsed)])

    expect(inGuard).toBe(user)
    expect(after).toEqual({ target: user })
    expect(users.fetch).toHaveBeenCalledTimes(1)
  })

  it('makes one request for an ID 50 messages name at the same time', async () => {
    const { message, users } = fresh()
    let settle!: (user: User) => void
    users.fetch.mockReturnValue(new Promise(resolve => (settle = resolve)) as never)
    const route = routeOf('whois {target:user}')
    const parsed = await Promise.all(Array.from({ length: 50 }, () => parseMessageParams(route, { target: ID(9) }, message, '!', undefined)))

    const fetched = Promise.all(parsed.map(one => fetchMessageParams(one)))
    settle({ id: ID(9) } as User)

    expect((await fetched).every(params => (params.target as User).id === ID(9))).toBe(true)
    expect(users.fetch).toHaveBeenCalledTimes(1)
  })

  it('asks for uncached members 100 to a gateway request, and for channels all at once', async () => {
    const { message, guild } = fresh()
    guild.members.fetch.mockImplementation(((async ({ user }: { user: string[] }) => new Collection(user.map(id => [id, member(id)])))))
    const members = await parseMessageParams(routeOf('kick {targets:member...}'), { targets: ids(150).join(' ') }, message, '!', undefined)

    const params = await fetchMessageParams(members)

    expect((params.targets as GuildMember[]).map(target => target.id)).toEqual(ids(150))
    expect(guild.members.fetch.mock.calls.map(([options]) => (options).user.length)).toEqual([100, 50])

    let inFlight = 0
    let most = 0
    guild.channels.fetch.mockImplementation(((async (id: string) => {
      most = Math.max(most, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      return { id } as TextChannel
    })))
    const channels = await parseMessageParams(routeOf('lock {targets:channel...}'), { targets: ids(20, 300).join(' ') }, message, '!', undefined)
    await fetchMessageParams(channels)
    expect(most).toBe(20)
  })

  it('names a role deleted while the guards ran, and a value of an app\'s own type that resolves to nothing', async () => {
    const role = { id: ID(23), name: 'mods' } as Role
    const guild = createMockGuild({ roles: [role] })
    const message = createMockMessage({ content: 'x', guild })
    const ticket: MessageParamType = { label: 'ticket', parse: word => ({ id: word, cached: undefined, resolve: () => Promise.resolve(undefined) }) }
    const parsed = await parseMessageParams(routeOf('check {r:role} {t:ticket}', { ticket }), { r: `<@&${ID(23)}>`, t: 'T-9' }, message, '!', { ticket })
    guild.roles.cache.delete(ID(23))

    const error = await fetchMessageParams(parsed).then(
      () => undefined,
      (thrown: unknown) => thrown as MessageUsageError,
    )

    expect(error!.issues).toEqual([
      { param: 'r', message: `r: <@&${ID(23)}> is not a role in this server` },
      { param: 't', message: 't: "T-9" is not a valid ticket' },
    ])
  })

  it('names each member, user or channel that does not exist, after the guards', async () => {
    const { message, guild, users } = fresh()
    guild.members.fetch.mockRejectedValue(new Error('Unknown Member'))
    users.fetch.mockRejectedValue(new Error('Unknown User'))
    guild.channels.fetch.mockResolvedValue(null)
    const parsed = await parseMessageParams(
      routeOf('check {m:member} {u:user} {c:channel}'),
      { m: ID(20), u: ID(21), c: `<#${ID(22)}>` },
      message,
      '!',
      undefined,
    )

    const error = await fetchMessageParams(parsed).then(
      () => undefined,
      (thrown: unknown) => thrown as MessageUsageError,
    )

    expect(error).toBeInstanceOf(MessageUsageError)
    expect(error!.issues).toEqual([
      { param: 'm', message: `m: <@${ID(20)}> is not a member of this server` },
      { param: 'u', message: `u: no user has the ID ${ID(21)}` },
      { param: 'c', message: `c: "<#${ID(22)}>" is not a channel` },
    ])
  })
})
