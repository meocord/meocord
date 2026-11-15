import { createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { REST } from 'discord.js'
import { isLoopback, keepRestLocal } from '@src/spec-local-rest.js'

afterEach(() => vi.restoreAllMocks())

describe('keepRestLocal', () => {
  it('refuses a request to Discord before it is sent', async () => {
    keepRestLocal()
    const rest = new REST({ retries: 0 }).setToken('token')

    await expect(rest.get('/applications/@me')).rejects.toThrow(
      "A spec's REST request to https://discord.com/api was refused before it was sent",
    )
  })

  it.each([
    ['http://127.0.0.1:8080/api', true],
    ['http://127.4.5.6/api', true],
    ['http://localhost:3000/api', true],
    ['http://[::1]:3000/api', true],
    ['https://discord.com/api', false],
    ['http://10.0.0.1/api', false],
    ['http://127.example.com/api', false],
    ['http://localhost.example.com/api', false],
  ])('reads %s as loopback: %s', (api, loopback) => {
    expect(isLoopback(api)).toBe(loopback)
  })

  it('sends a request to a stand-in on loopback', async () => {
    keepRestLocal()
    const server = createServer((_request, response) => response.setHeader('content-type', 'application/json').end('{"id":"1"}'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const rest = new REST({ retries: 0, api: `http://127.0.0.1:${port}/api` }).setToken('token')
      await expect(rest.get('/applications/@me')).resolves.toEqual({ id: '1' })
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })

  it('leaves a client that answers in-process alone', async () => {
    keepRestLocal()
    const makeRequest = vi.fn(async () => new Response('{"id":"1"}', { headers: { 'content-type': 'application/json' } }))
    const rest = new REST({ retries: 0, makeRequest: makeRequest as never }).setToken('token')

    await expect(rest.get('/applications/@me')).resolves.toEqual({ id: '1' })
    expect(makeRequest).toHaveBeenCalledOnce()
  })
})
