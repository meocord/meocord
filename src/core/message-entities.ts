import { type Client, Collection, type Guild, type GuildBasedChannel, type GuildMember, type Role, type User } from 'discord.js'
import { type EntityRef } from '@src/interface/index.js'

/** The kinds of Discord entity a message param names. */
export type EntityKind = 'member' | 'user' | 'role' | 'channel'

type EntityOf<K extends EntityKind> = { member: GuildMember; user: User; role: Role; channel: GuildBasedChannel }[K]

/** Fetches in flight for a client, by kind, server and ID, so callers asking at once share one request. */
const inFlight = new WeakMap<Client, Map<string, Promise<unknown>>>()

/** The one request for `key`: the one in flight, or a new one from `start`, forgotten once it settles. */
function singleFlight<T>(client: Client, key: string, start: () => Promise<T>): Promise<T> {
  let requests = inFlight.get(client)
  if (!requests) inFlight.set(client, (requests = new Map()))
  const pending = requests.get(key) as Promise<T> | undefined
  if (pending) return pending
  const request = start().finally(() => requests.delete(key))
  requests.set(key, request)
  return request
}

const keyOf = (kind: EntityKind, guild: Guild | null, id: string) => `${kind}:${guild?.id ?? ''}:${id}`

/** A member, user, role or channel a message names, read from the cache and fetched only when asked. */
export class MessageEntityRef<K extends EntityKind = EntityKind> implements EntityRef<EntityOf<K>> {
  constructor(
    readonly kind: K,
    readonly id: string,
    readonly client: Client,
    readonly guild: Guild | null,
  ) {}

  get cached(): EntityOf<K> | undefined {
    switch (this.kind) {
      case 'member':
        return this.guild?.members.cache.get(this.id) as EntityOf<K> | undefined
      case 'user':
        return this.client.users.cache.get(this.id) as EntityOf<K> | undefined
      case 'role':
        return this.guild?.roles.cache.get(this.id) as EntityOf<K> | undefined
      default:
        return this.guild?.channels.cache.get(this.id) as EntityOf<K> | undefined
    }
  }

  /** This ref's fetch once started, so a guard's `resolve()` and the fetch after the guards share it. */
  fetching: Promise<EntityOf<K> | undefined> | undefined

  resolve(): Promise<EntityOf<K> | undefined> {
    const cached = this.cached
    if (cached || this.kind === 'role') return Promise.resolve(cached)
    return (this.fetching ??= singleFlight(this.client, keyOf(this.kind, this.guild, this.id), () =>
      fetchOne(this.kind, this.id, this.client, this.guild),
    ) as Promise<EntityOf<K> | undefined>)
  }
}

/** One entity by ID, from Discord: `undefined` when there is none, or the request fails. */
async function fetchOne(kind: EntityKind, id: string, client: Client, guild: Guild | null): Promise<unknown> {
  if (kind === 'member') return (await guild?.members.fetch(id).catch(() => undefined)) ?? undefined
  if (kind === 'user') return (await client.users.fetch(id).catch(() => undefined)) ?? undefined
  if (kind === 'channel') return (await guild?.channels.fetch(id).catch(() => undefined)) ?? undefined
  return guild?.roles.cache.get(id)
}

/** The most member IDs Discord's Request Guild Members takes in one request. */
const MEMBERS_PER_REQUEST = 100

/**
 * The entities these refs name, each read from the cache or fetched once, however many refs, messages and guards ask at
 * once. A server's members not cached, two or more, go out over the gateway, 100 IDs to a request, and a lone one on
 * its own; users wait their turn in the one queue Discord's REST client keeps for every user lookup; channels go
 * together, each in a queue of its own. A ref whose entity does not exist resolves to `undefined`.
 */
export async function resolveRefs(refs: readonly MessageEntityRef[]): Promise<Map<MessageEntityRef, unknown>> {
  const found = new Map<MessageEntityRef, unknown>()
  const byKey = new Map<string, MessageEntityRef[]>()
  const uncachedMembers = new Map<Guild, MessageEntityRef[]>()
  for (const ref of refs) {
    const cached = ref.cached
    if (cached || ref.kind === 'role') {
      found.set(ref, cached)
      continue
    }
    const key = keyOf(ref.kind, ref.guild, ref.id)
    if (byKey.has(key)) {
      byKey.get(key)!.push(ref)
      continue
    }
    byKey.set(key, [ref])
    const guild = ref.guild
    const requests = inFlight.get(ref.client)
    if (ref.kind === 'member' && guild && !ref.fetching && !requests?.has(key)) uncachedMembers.set(guild, [...(uncachedMembers.get(guild) ?? []), ref])
  }

  // The uncached members of a server with two or more, 100 to a gateway request, each ID joining the one flight
  for (const [guild, members] of uncachedMembers) {
    if (members.length < 2) continue
    for (let at = 0; at < members.length; at += MEMBERS_PER_REQUEST) {
      const chunk = members.slice(at, at + MEMBERS_PER_REQUEST)
      const batch = guild.members.fetch({ user: chunk.map(ref => ref.id) }).catch(() => undefined)
      for (const ref of chunk) {
        void singleFlight(ref.client, keyOf('member', guild, ref.id), async () => {
          const members = await batch
          // A batch the gateway refused: this ID on its own
          return members instanceof Collection ? members.get(ref.id) : fetchOne('member', ref.id, ref.client, guild)
        })
      }
    }
  }

  const unique = [...byKey.values()].map(([ref]) => ref)
  const results = await Promise.all(unique.map(ref => ref.resolve()))
  unique.forEach((ref, i) => {
    for (const same of byKey.get(keyOf(ref.kind, ref.guild, ref.id))!) found.set(same, results[i])
  })
  return found
}
