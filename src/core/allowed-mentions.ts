import { type ClientOptions } from 'discord.js'

/**
 * What an app whose `clientOptions.allowedMentions` is unset is told at startup: discord.js sends each payload that sets
 * none with the client's default, so a reply pings whoever its text mentions. 5.0 makes `{ parse: [] }` the default
 * (https://github.com/meocord/meocord/issues/501).
 */
export const UNSET_ALLOWED_MENTIONS_WARNING =
  'Replies ping whoever their text mentions, since clientOptions.allowedMentions is unset. In the next major version ' +
  '(5.0) they ping no one unless a reply says so. Set clientOptions.allowedMentions to { parse: [] } to have that now, ' +
  "or to { parse: ['users', 'roles', 'everyone'], repliedUser: true } to keep every mention."

/** The startup warning for an app's client options: undefined once they set `allowedMentions` to anything. */
export function allowedMentionsWarning(clientOptions: Partial<ClientOptions> | undefined): string | undefined {
  return clientOptions?.allowedMentions === undefined ? UNSET_ALLOWED_MENTIONS_WARNING : undefined
}
