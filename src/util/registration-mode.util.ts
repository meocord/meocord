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

/** The guild `meocord register --guild` registers every command to; undefined without one, a blank value included. */
export function registerGuildOf(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[REGISTER_GUILD_ENV] || undefined
}

/** Set by `meocord register --prune`: `declared`, or `all` for `--prune all`. */
export const PRUNE_ENV = 'MEOCORD_REGISTER_PRUNE'

/** Set by `--prune-guild <id>`, each id once, separated by commas: servers `--prune` checks besides the bot's. */
export const PRUNE_GUILDS_ENV = 'MEOCORD_REGISTER_PRUNE_GUILDS'

/** Set by `--after <id>`: the server `--prune` resumes its paging after. */
export const PRUNE_AFTER_ENV = 'MEOCORD_REGISTER_PRUNE_AFTER'

/** Set by `--dry-run`: `--prune` registers nothing and removes nothing, and reports what it would remove. */
export const PRUNE_DRY_RUN_ENV = 'MEOCORD_REGISTER_PRUNE_DRY_RUN'

/** Set by `--yes`: `--prune all` removes the commands not declared by this build without asking. */
export const PRUNE_YES_ENV = 'MEOCORD_REGISTER_PRUNE_YES'

/**
 * Every variable above. The CLI owns them: a bot it starts gets each one as this run's flags set it, and blank
 * otherwise, never a value inherited from the shell or loaded from a .env file, which would steer a run no flag asked for.
 */
export const CLI_REGISTRATION_ENV = [
  REGISTER_ONLY_ENV,
  REGISTER_GUILD_ENV,
  FORCE_REGISTER_ENV,
  REGISTER_MODE_ENV,
  PRUNE_ENV,
  PRUNE_GUILDS_ENV,
  PRUNE_AFTER_ENV,
  PRUNE_DRY_RUN_ENV,
  PRUNE_YES_ENV,
] as const

/** What `meocord register --prune` asks for, as the CLI hands it to the bundle. */
export interface PruneRequest {
  mode: 'declared' | 'all'
  guilds: string[]
  after?: string
  dryRun: boolean
  yes: boolean
}

/** What `meocord register --prune` asked the bundle for; `undefined` without `--prune`. */
export function pruneRequestOf(env: NodeJS.ProcessEnv = process.env): PruneRequest | undefined {
  const mode = env[PRUNE_ENV]
  if (mode !== 'declared' && mode !== 'all') return undefined
  return {
    mode,
    guilds: (env[PRUNE_GUILDS_ENV] ?? '').split(',').filter(Boolean),
    ...(env[PRUNE_AFTER_ENV] && { after: env[PRUNE_AFTER_ENV] }),
    dryRun: env[PRUNE_DRY_RUN_ENV] === '1',
    yes: env[PRUNE_YES_ENV] === '1',
  }
}
