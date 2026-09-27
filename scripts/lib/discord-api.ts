/**
 * The few Discord REST calls scripts/e2e.ts makes to check what a bot did, as one bot. Errors name the
 * route and Discord's answer, never the token.
 */

const API = 'https://discord.com/api/v10'

/** A command as Discord stores it: `version` changes whenever the command is updated. */
export interface RegisteredCommand {
  id: string
  name: string
  version: string
}

/** A message as Discord stores it, as far as the checks read it. */
export interface StoredMessage {
  id: string
  content: string
  author: { id: string }
  embeds: { title?: string; color?: number }[]
  message_reference?: { message_id?: string }
}

export class DiscordApi {
  constructor(private readonly token: string) {}

  /** Sends one request, waiting out a rate limit up to three times. */
  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${API}${route}`, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://meocord.dev, e2e)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (response.status === 429 && attempt < 3) {
        const { retry_after } = (await response.json()) as { retry_after?: number }
        await new Promise(resolve => setTimeout(resolve, (retry_after ?? 1) * 1_000 + 100))
        continue
      }
      if (!response.ok) throw new Error(`Discord answered ${method} ${route} with ${response.status}: ${await response.text()}`)
      return (response.status === 204 ? undefined : await response.json()) as T
    }
  }

  applicationId(): Promise<string> {
    return this.request<{ id: string }>('GET', '/applications/@me').then(({ id }) => id)
  }

  guildCommands(applicationId: string, guildId: string): Promise<RegisteredCommand[]> {
    return this.request('GET', `/applications/${applicationId}/guilds/${guildId}/commands`)
  }

  /** Replaces the guild's commands with none. */
  clearGuildCommands(applicationId: string, guildId: string): Promise<RegisteredCommand[]> {
    return this.request('PUT', `/applications/${applicationId}/guilds/${guildId}/commands`, [])
  }

  globalCommands(applicationId: string): Promise<RegisteredCommand[]> {
    return this.request('GET', `/applications/${applicationId}/commands`)
  }

  /** The user the token belongs to. */
  currentUser(): Promise<{ id: string }> {
    return this.request('GET', '/users/@me')
  }

  message(channelId: string, messageId: string): Promise<StoredMessage> {
    return this.request('GET', `/channels/${channelId}/messages/${messageId}`)
  }

  /** The channel's messages sent after `messageId`, newest first. */
  messagesAfter(channelId: string, messageId: string): Promise<StoredMessage[]> {
    return this.request('GET', `/channels/${channelId}/messages?after=${messageId}&limit=50`)
  }

  sendMessage(channelId: string, content: string): Promise<{ id: string }> {
    return this.request('POST', `/channels/${channelId}/messages`, { content, allowed_mentions: { parse: [] } })
  }

  react(channelId: string, messageId: string, emoji: string): Promise<void> {
    return this.request('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`)
  }

  deleteMessage(channelId: string, messageId: string): Promise<void> {
    return this.request('DELETE', `/channels/${channelId}/messages/${messageId}`)
  }
}
