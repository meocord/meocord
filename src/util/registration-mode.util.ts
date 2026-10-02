/**
 * Environment the CLI sets for the application it runs, read by the bundle at startup. Names are
 * shared here so the CLI and the runtime cannot drift apart.
 */

/** Set by `meocord register`: register the commands over REST and exit, without logging in. */
export const REGISTER_ONLY_ENV = 'MEOCORD_REGISTER_ONLY'

/** Set by `meocord register --guild <id>`: register every command to that guild only. */
export const REGISTER_GUILD_ENV = 'MEOCORD_REGISTER_GUILD'

/** Set by `meocord start --force-register` and by `meocord register`: send even an unchanged payload. */
export const FORCE_REGISTER_ENV = 'MEOCORD_FORCE_REGISTER'

/** Whether this process was started to register commands and exit. */
export function isRegisterOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REGISTER_ONLY_ENV] === '1'
}
