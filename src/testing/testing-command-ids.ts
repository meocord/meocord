import { createHash } from 'node:crypto'
import { type CollectedCommand, collectCommands, SILENT_LOGGER } from '@src/core/command-identity.js'
import { type CommandIdSource } from '@src/core/command-ids.js'

/** The digits a fixed ID takes from its name's hash, after a leading `1`: eighteen in all, the length of a snowflake. */
const FIXED_ID_DIGITS = 17n

/** Whether a string is shaped as a Discord snowflake: 17 to 20 digits. */
export const SNOWFLAKE = /^\d{17,20}$/

/** The ID a testing module gives a command: snowflake-shaped, and the same for a name in every run. */
export function fixedCommandId(name: string): string {
  const hash = BigInt(`0x${createHash('sha256').update(name).digest('hex')}`)
  return `1${(hash % 10n ** FIXED_ID_DIGITS).toString().padStart(Number(FIXED_ID_DIGITS), '0')}`
}

/** A testing module's command IDs: from the commands its controllers declare, with no request. */
export function testingCommandIds(
  controllers: readonly (new (...args: any[]) => unknown)[],
  overrides: ReadonlyMap<string, string>,
): CommandIdSource {
  let declared: readonly CollectedCommand[] | undefined
  return {
    declared: () => (declared ??= collectCommands([...controllers], SILENT_LOGGER) ?? []),
    idOf: async (_client, _guild, { words: [name] }) => overrides.get(name) ?? fixedCommandId(name),
  }
}
