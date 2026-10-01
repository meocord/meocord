import { vi } from 'vitest'
import { Client, Sweepers } from 'discord.js'
import { undoFailedLogin } from '@src/core/failed-login.js'

const destroyedFlag = (client: Client) => (client.ws as unknown as { destroyed: boolean }).destroyed
/** The manager's connect, private in discord.js's types, which these cases stand in for. */
const connectOf = (client: Client) => client.ws as unknown as { connect: () => Promise<void> }

const sweeperIntervals = (client: Client) => (client.sweepers as unknown as { intervals: Record<string, unknown> }).intervals

/** A client whose gateway connection fails, as an unreachable Discord does, with a message sweeper configured. */
function failingClient() {
  const client = new Client({ intents: [], sweepers: { messages: { interval: 3600, lifetime: 1800 } } })
  vi.spyOn(connectOf(client), 'connect').mockRejectedValue(new Error('getaddrinfo ENOTFOUND discord.com'))
  return client
}

afterEach(() => vi.restoreAllMocks())

// What undoFailedLogin undoes. If a discord.js release stops destroying the client on a failed login, or resets these
// itself, this fails, and the workaround can go.
describe("discord.js's failed login", () => {
  it('destroys the client: its WebSocket manager is marked destroyed and its sweepers stop', async () => {
    const client = failingClient()
    const destroy = vi.spyOn(client.sweepers as unknown as { destroy: () => void }, 'destroy')
    expect(destroyedFlag(client)).toBe(false)

    await expect(client.login('token')).rejects.toThrow('ENOTFOUND')

    expect(destroyedFlag(client)).toBe(true)
    expect(destroy).toHaveBeenCalled()
    expect(client.isReady()).toBe(false)
    await client.destroy()
  })

  it('leaves the manager destroyed through a later connect, which then skips closing the gateway', async () => {
    const client = failingClient()
    await client.login('token').catch(() => undefined)

    vi.mocked(connectOf(client).connect).mockResolvedValue(undefined)
    await client.login('token')

    expect(destroyedFlag(client)).toBe(true)
    await client.destroy()
  })
})

describe('undoFailedLogin', () => {
  it('lets a client that failed to log in log in again as a fresh one would', async () => {
    const client = failingClient()
    await client.login('token').catch(() => undefined)
    const stopped = client.sweepers

    undoFailedLogin(client)
    vi.mocked(connectOf(client).connect).mockResolvedValue(undefined)
    await client.login('token')

    expect(destroyedFlag(client)).toBe(false)
    expect(client.sweepers).toBeInstanceOf(Sweepers)
    expect(client.sweepers).not.toBe(stopped)
    expect(sweeperIntervals(client).messages).toBeDefined()
    await client.destroy()
    expect(destroyedFlag(client)).toBe(true)
  })

  it('leaves a client that never failed as it is', () => {
    const client = new Client({ intents: [] })
    const sweepers = client.sweepers

    undoFailedLogin(client)

    expect(client.sweepers).toBe(sweepers)
    expect(destroyedFlag(client)).toBe(false)
  })
})
