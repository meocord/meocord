/**
 * A stand-in for Discord's REST API and gateway, for a client whose login must be in flight for a while and then
 * complete: `/gateway/bot` points at its own WebSocket, which says HELLO and answers IDENTIFY with READY after
 * `readyDelayMs`. Every other REST call gets an empty answer. It records what happened, for a check to wait on.
 */

import { createServer } from 'http'
import { type AddressInfo } from 'net'
import { WebSocketServer } from 'ws'

/** What the gateway saw, in order. */
export type FakeDiscordEvent = 'connected' | 'identified' | 'ready' | 'closed'

export interface FakeDiscord {
  /** The REST base to give a client as `rest.api`. */
  api: string
  events: FakeDiscordEvent[]
  /** Resolves once the gateway has seen `event` `count` times. */
  waitFor(event: FakeDiscordEvent, count?: number): Promise<void>
  close(): Promise<void>
}

export async function startFakeDiscord({ readyDelayMs }: { readyDelayMs: number }): Promise<FakeDiscord> {
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
      response.end(request.method === 'GET' ? '{}' : '[]')
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
        const application = { id: '100000000000000001', flags: 0 }
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
