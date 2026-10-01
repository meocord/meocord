import { type Client, Sweepers } from 'discord.js'

/**
 * Undoes what discord.js's `Client.login` does to its client when the login fails, so the same client can log in
 * again. A failed login calls `destroy()`, which marks the WebSocket manager destroyed and stops the cache sweepers,
 * and a later login resets neither: `isReady()` would stay false, shutdown would skip closing the gateway, and the
 * caches would never be swept. A workaround for discord.js internals (its manager's private `destroyed` flag), which
 * failed-login.spec.ts pins, so a discord.js change to either fails there.
 */
export function undoFailedLogin(client: Client): void {
  // A hand-built client in a test may have no manager
  const ws = client.ws as unknown as { destroyed?: boolean } | undefined
  if (!ws?.destroyed) return
  ws.destroyed = false
  client.sweepers = new Sweepers(client as Client<true>, client.options.sweepers ?? {})
}
