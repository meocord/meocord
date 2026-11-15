/**
 * A stand-in for Discord's REST API and gateway, for a client whose login must be in flight for a while and then
 * complete: `/gateway/bot` points at its own WebSocket, which says HELLO and answers IDENTIFY with READY after
 * `readyDelayMs`. Given `commands`, it also answers what registration and `register --prune` ask: the application, the
 * servers the bot is in, and each server's commands; every other REST call gets an empty answer. It records what
 * happened, for a check to wait on.
 */

import { createServer } from 'http'
import { type AddressInfo } from 'net'
import { WebSocketServer } from 'ws'

/** What the gateway saw, in order. */
export type FakeDiscordEvent = 'connected' | 'identified' | 'ready' | 'closed'

/** The application the fake gateway and REST name. */
const APPLICATION_ID = '100000000000000001'

/** What the fake holds for registration: the servers the bot is in, by id with their names, and their commands. */
export interface FakeCommands {
  servers: Record<string, { name: string; commands: { name: string; type?: number }[] }>
}

export interface FakeDiscord {
  /** The REST base to give a client as `rest.api`. */
  api: string
  events: FakeDiscordEvent[]
  /** Resolves once the gateway has seen `event` `count` times. */
  waitFor(event: FakeDiscordEvent, count?: number): Promise<void>
  close(): Promise<void>
}

/** The answer to a registration request, or `undefined` for one the fake answers as any other. */
function commandAnswer(method: string | undefined, url: URL, { servers }: FakeCommands): unknown {
  const route = url.pathname.replace(/^\/api\/v\d+/, '')
  if (method === 'GET' && route === '/applications/@me') return { id: APPLICATION_ID, flags: 0 }
  if (method === 'GET' && route === '/users/@me/guilds') {
    const after = url.searchParams.get('after') ?? ''
    return Object.entries(servers)
      .filter(([id]) => id > after)
      .map(([id, { name }]) => ({ id, name }))
  }
  const server = route.match(/^\/applications\/\d+\/guilds\/(\d+)\/commands$/)?.[1]
  if (method === 'GET' && server) {
    // The keys Discord lists a server command with, without with_localizations
    return (servers[server]?.commands ?? []).map((command, index) => ({
      id: `${server}${index}`,
      application_id: APPLICATION_ID,
      guild_id: server,
      version: `${server}${index}`,
      type: 1,
      description: command.name,
      default_member_permissions: null,
      nsfw: false,
      ...command,
    }))
  }
  return undefined
}

export async function startFakeDiscord({ readyDelayMs, commands }: { readyDelayMs: number; commands?: FakeCommands }): Promise<FakeDiscord> {
  const events: FakeDiscordEvent[] = []
  const waiters = new Set<() => void>()
  const record = (event: FakeDiscordEvent) => {
    events.push(event)
    for (const waiter of waiters) waiter()
  }

  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url?.endsWith('/gateway/bot')) {
      const { port } = server.address() as AddressInfo
      const limit = { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 }
      response.end(JSON.stringify({ url: `ws://127.0.0.1:${port}`, shards: 1, session_start_limit: limit }))
    } else {
      const answer = commands && commandAnswer(request.method, new URL(request.url ?? '/', 'http://fake'), commands)
      response.end(answer !== undefined ? JSON.stringify(answer) : request.method === 'GET' ? '{}' : '[]')
    }
  })

  const gateway = new WebSocketServer({ server })
  gateway.on('connection', socket => {
    record('connected')
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 }, s: null, t: null }))
    socket.on('message', raw => {
      const { op } = JSON.parse(String(raw)) as { op: number }
      if (op === 1) socket.send(JSON.stringify({ op: 11, d: null, s: null, t: null }))
      if (op !== 2) return
      record('identified')
      setTimeout(() => {
        if (socket.readyState !== socket.OPEN) return
        const user = { id: '100000000000000001', username: 'fake', discriminator: '0', global_name: null, avatar: null, bot: true }
        const application = { id: APPLICATION_ID, flags: 0 }
        const d = { v: 10, user, guilds: [], session_id: 'fake', resume_gateway_url: 'ws://127.0.0.1', application, shard: [0, 1] }
        socket.send(JSON.stringify({ op: 0, s: 1, t: 'READY', d }))
        record('ready')
      }, readyDelayMs)
    })
    socket.on('close', () => record('closed'))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    api: `http://127.0.0.1:${port}/api`,
    events,
    waitFor: (event, count = 1) =>
      new Promise(resolve => {
        const check = () => {
          if (events.filter(seen => seen === event).length < count) return
          waiters.delete(check)
          resolve()
        }
        waiters.add(check)
        check()
      }),
    close: async () => {
      for (const socket of gateway.clients) socket.terminate()
      await new Promise(resolve => gateway.close(resolve))
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
