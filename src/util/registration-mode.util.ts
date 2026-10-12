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

/**
 * Set by the CLI for every bot it starts: `development` or `production`, the mode the command runs in. A bundle built
 * with `bundleDependencies` has `process.env.NODE_ENV` written in as the mode it was built in, MeoCord's own reads
 * included, so the command's mode reaches it through this variable instead.
 */
export const REGISTER_MODE_ENV = 'MEOCORD_REGISTER_MODE'

/**
 * Whether commands register as development does, to `commands.developmentGuild`: as the CLI command that started the
 * bot says, else as `NODE_ENV` says.
 */
export function registersAsDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env[REGISTER_MODE_ENV]
  if (mode === 'development' || mode === 'production') return mode === 'development'
  return process.env.NODE_ENV === 'development'
}

/** Whether this process was started to register commands and exit. */
export function isRegisterOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REGISTER_ONLY_ENV] === '1'
}
