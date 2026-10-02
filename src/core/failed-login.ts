import { type Client, Sweepers } from 'discord.js'

/**
 * Undoes what a failed `Client.login` does to the client, so it can log in again: its `destroy()` marks the WebSocket
 * manager destroyed and stops the sweepers, which a later login resets neither of, so `isReady()` stays false, shutdown
 * skips the gateway and caches go unswept. It reaches into discord.js internals, which failed-login.spec.ts pins.
 */
export function undoFailedLogin(client: Client): void {
  // A hand-built client in a test may have no manager
  const ws = client.ws as unknown as { destroyed?: boolean } | undefined
  if (!ws?.destroyed) return
  ws.destroyed = false
  client.sweepers = new Sweepers(client as Client<true>, client.options.sweepers ?? {})
}
