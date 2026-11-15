// Keeps the specs' REST requests on this machine; no entry point imports this file, so it never ships
import { REST } from 'discord.js'
import { vi } from 'vitest'

/**
 * A REST base on loopback, where a spec's stand-in for Discord listens: 127.0.0.0/8, `::1` or `localhost`. A stand-in
 * bound to another of this machine's addresses is refused too.
 */
const LOOPBACK = /^https?:\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?(?:\/|$)/

/** Whether a REST base is on loopback. */
export const isLoopback = (api: string): boolean => LOOPBACK.test(api)

/**
 * Refuses, before it is sent, every request a REST client of this class would make to anywhere but this machine. A
 * spec that runs registration builds no REST client of its own: MeoCord does, from the options it is given, so a path
 * that ignores the local stand-in would otherwise send the spec's dummy token to Discord. A client given its own
 * `makeRequest` answers in-process and is left alone. Call it in each test, with the class the test's modules use;
 * `vi.restoreAllMocks()` undoes it.
 */
export function keepRestLocal(rest: typeof REST = REST): void {
  const network = new rest().options.makeRequest
  const send = rest.prototype.request
  vi.spyOn(rest.prototype, 'request').mockImplementation(function (this: REST, ...args: Parameters<REST['request']>) {
    if (this.options.makeRequest === network && !isLoopback(this.options.api)) {
      return Promise.reject(new Error(`A spec's REST request to ${this.options.api} was refused before it was sent: specs reach only a stand-in on this machine.`))
    }
    return send.apply(this, args)
  })
}
