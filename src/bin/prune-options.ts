import { type Command } from 'commander'
import {
  PRUNE_AFTER_ENV,
  PRUNE_DRY_RUN_ENV,
  PRUNE_ENV,
  PRUNE_GUILDS_ENV,
  PRUNE_YES_ENV,
} from '@src/util/registration-mode.util.js'

/** Adds to `meocord register` the options that find and remove the commands left in servers the config no longer names. */
export function withPruneOptions(command: Command): Command {
  return command
    .option(
      '--prune [all]',
      "Then remove this app's commands from servers the configuration no longer names; 'all' also removes those not declared by this build",
    )
    .option('--prune-guild <id>', 'With --prune, also check this server, whether or not the bot is in it (repeatable)', (id: string, ids: string[]) => [...ids, id], [] as string[])
    .option('--after <id>', 'With --prune, go on checking after this server, as a stopped --prune says')
    .option('--dry-run', 'With --prune, register nothing and remove nothing: report what --prune would remove')
    .option('-y, --yes', "With --prune all, remove the commands not declared by this build without asking")
}

/** The `register` options that shape a prune, as commander parses them. */
export interface PruneFlags {
  prune?: boolean | string
  pruneGuild?: string[]
  after?: string
  dryRun?: boolean
  yes?: boolean
}

/**
 * The environment a `register` run's flags give the bundle, or what is wrong with them: `--prune` takes no value or
 * `all`, and the options that shape a prune apply only with it.
 */
export function pruneEnvOf(flags: PruneFlags): { env: Record<string, string> } | { problem: string } {
  if (flags.prune === undefined || flags.prune === false) {
    const stray = [
      flags.dryRun && '--dry-run',
      flags.yes && '--yes',
      flags.pruneGuild?.length && '--prune-guild',
      flags.after !== undefined && '--after',
    ].filter(Boolean)
    return stray.length > 0 ? { problem: `${stray.join(', ')} ${stray.length === 1 ? 'applies' : 'apply'} only with --prune.` } : { env: {} }
  }
  if (flags.prune !== true && flags.prune !== 'all') return { problem: `--prune takes no value or 'all', not '${flags.prune}'.` }
  const guilds = [...new Set((flags.pruneGuild ?? []).map(id => id.trim()))]
  if (guilds.some(id => !id)) return { problem: '--prune-guild was given no server id.' }
  if (flags.after !== undefined && !flags.after.trim()) return { problem: '--after was given no server id.' }
  return {
    env: {
      [PRUNE_ENV]: flags.prune === 'all' ? 'all' : 'declared',
      ...(guilds.length > 0 && { [PRUNE_GUILDS_ENV]: guilds.join(',') }),
      ...(flags.after !== undefined && { [PRUNE_AFTER_ENV]: flags.after.trim() }),
      ...(flags.dryRun && { [PRUNE_DRY_RUN_ENV]: '1' }),
      ...(flags.yes && { [PRUNE_YES_ENV]: '1' }),
    },
  }
}

