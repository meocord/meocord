import { Command } from 'commander'
import { pruneEnvOf, withPruneOptions } from '@src/bin/prune-options.js'

/** Parses `register`'s arguments as the CLI does, with `--guild` beside the prune options. */
function parse(...args: string[]) {
  const register = withPruneOptions(new Command('register').exitOverride().option('-g, --guild <id>', 'guild'))
  register.parse(args, { from: 'user' })
  return register.opts()
}

describe('register --prune', () => {
  it.each([
    [['--prune'], 'declared'],
    [['--prune', 'all'], 'all'],
    [['--prune=all'], 'all'],
  ])('reads %j as %s', (args, mode) => {
    expect(pruneEnvOf(parse(...args))).toEqual({ env: { MEOCORD_REGISTER_PRUNE: mode } })
  })

  it('reads a flag after --prune as its own option, not as the value', () => {
    const options = parse('--prune', '--guild', '1')

    expect(options.guild).toBe('1')
    expect(pruneEnvOf(options)).toEqual({ env: { MEOCORD_REGISTER_PRUNE: 'declared' } })
  })

  it.each([['--prune', 'bogus'], ['--prune=bogus']])('refuses %j by name', (...args) => {
    expect(pruneEnvOf(parse(...args))).toEqual({ problem: "--prune takes no value or 'all', not 'bogus'." })
  })

  it('hands on each server --prune-guild adds once, --after, --dry-run and --yes', () => {
    const options = parse('--prune', 'all', '--prune-guild', '9', '--prune-guild', '8', '--prune-guild', '9', '--after', '5', '--dry-run', '-y')

    expect(pruneEnvOf(options)).toEqual({
      env: {
        MEOCORD_REGISTER_PRUNE: 'all',
        MEOCORD_REGISTER_PRUNE_GUILDS: '9,8',
        MEOCORD_REGISTER_PRUNE_AFTER: '5',
        MEOCORD_REGISTER_PRUNE_DRY_RUN: '1',
        MEOCORD_REGISTER_PRUNE_YES: '1',
      },
    })
  })

  it.each([
    [['--dry-run'], '--dry-run applies only with --prune.'],
    [['--yes', '--prune-guild', '1'], '--yes, --prune-guild apply only with --prune.'],
    [['--after', '1'], '--after applies only with --prune.'],
    [['--prune', '--prune-guild', ' '], '--prune-guild was given no server id.'],
    [['--prune', '--after', ''], '--after was given no server id.'],
  ])('refuses %j', (args, problem) => {
    expect(pruneEnvOf(parse(...args))).toEqual({ problem })
  })

  it('adds nothing to a run without --prune', () => {
    expect(pruneEnvOf(parse('--guild', '1'))).toEqual({ env: {} })
  })
})
