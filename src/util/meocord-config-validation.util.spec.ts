import {
  CHECKED_COMMANDS_KEYS,
  CHECKED_CONFIG_KEYS,
  CHECKED_SHARDING_KEYS,
  configProblems,
} from '@src/util/meocord-config-validation.util.js'

describe('configProblems', () => {
  it('finds nothing wrong with a valid configuration', () => {
    expect(
      configProblems({
        appName: 'Bot',
        discordToken: 'token',
        bundleDependencies: true,
        externals: ['sharp', /^@img\//],
        optionalExternals: ['zlib-sync'],
        rsbuild: (config: unknown) => config,
        shutdownTimeout: 5_000,
        commands: { guilds: ['1'], developmentGuild: '2', register: false, clearOther: true },
        sharding: { mode: 'process', shards: 'auto', development: false },
      }),
    ).toEqual({ errors: [], warnings: [] })
  })

  it('lists every option of the wrong type', () => {
    const { errors } = configProblems({
      discordToken: 42,
      sharding: { mode: 'bogus', shards: 0 },
      commands: { guilds: 'one', register: 'yes' },
      optionalExternals: 'sharp',
      shutdownTimeout: -1,
      rsbuild: {},
    })

    expect(errors).toEqual([
      'discordToken must be a string (got 42)',
      "sharding.mode must be 'internal' or 'process' (got 'bogus')",
      "sharding.shards must be 'auto' or a whole number of shards, 1 or more (got 0)",
      "commands.guilds must be an array of guild ids (got 'one')",
      "commands.register must be true or false (got 'yes')",
      "optionalExternals must be an array of package names (got 'sharp')",
      'shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got -1)',
      'rsbuild must be a function (got object)',
    ])
  })

  it('shows the number it got, so a shard count or timeout that is out of range says which', () => {
    expect(configProblems({ sharding: { shards: 2.5 }, shutdownTimeout: Number.NaN }).errors).toEqual([
      "sharding.shards must be 'auto' or a whole number of shards, 1 or more (got 2.5)",
      'shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got NaN)',
    ])
  })

  // The shard manager and the CLI wait a margin on top, and Node fires a timer past its limit at once
  it.each([2_147_478_648, Infinity])('refuses a shutdownTimeout that leaves no room for the margins on top (%s)', shutdownTimeout => {
    expect(configProblems({ shutdownTimeout }).errors).toEqual([
      `shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got ${shutdownTimeout})`,
    ])
  })

  it.each([0, 2_147_478_647])('takes a shutdownTimeout of %s', shutdownTimeout => {
    expect(configProblems({ discordToken: 't', shutdownTimeout }).errors).toEqual([])
  })

  // `[process.env.GUILD_ID]` with the variable unset; registration drops the blank ids
  it('accepts guild ids an unset environment variable leaves undefined', () => {
    expect(configProblems({ discordToken: 't', commands: { guilds: [undefined, '1'] } }).errors).toEqual([])
  })

  it('checks logLevel against the levels', () => {
    expect(configProblems({ discordToken: 't', logLevel: 'warn' }).errors).toEqual([])
    expect(configProblems({ discordToken: 't', logLevel: 'verbose' }).errors).toEqual([
      "logLevel must be 'debug' or 'log' or 'warn' or 'error' or 'silent' (got 'verbose')",
    ])
  })

  it('warns about options it does not know, at the top and nested, without failing', () => {
    expect(configProblems({ discordToken: 't', bundleDependancies: true, sharding: { shard: 2 } })).toEqual({
      errors: [],
      warnings: ['bundleDependancies is not a MeoCord option, so it has no effect.', 'sharding.shard is not a MeoCord option, so it has no effect.'],
    })
  })

  // jiti hands the CLI an interop proxy whose own keys are only `default`.
  it('reads through a module namespace with a default export', () => {
    expect(configProblems({ default: { discordToken: 7 } }).errors).toEqual(['discordToken must be a string (got 7)'])
  })

  it('refuses a default export that is not an object', () => {
    expect(configProblems('token').errors).toEqual(["it must export an object as its default export (got 'token')"])
  })

  // The shape is typed against MeoCordConfig, so an option added there without a check fails to compile; this
  // names what is checked, so a change to either shows up in review.
  it('checks every option MeoCordConfig declares', () => {
    expect([...CHECKED_CONFIG_KEYS].sort()).toEqual(
      ['appName', 'bundleDependencies', 'commands', 'discordToken', 'externals', 'logLevel', 'optionalExternals', 'rsbuild', 'sharding', 'shutdownTimeout', 'sourceMappedStacks', 'startupErrors'].sort(),
    )
  })

  // Typed against CommandRegistrationConfig and ShardingConfig, as the top level is against MeoCordConfig
  it('checks every option of commands and sharding', () => {
    expect([...CHECKED_COMMANDS_KEYS].sort()).toEqual(['clearOther', 'developmentGuild', 'guilds', 'register'])
    expect([...CHECKED_SHARDING_KEYS].sort()).toEqual(['development', 'mode', 'shards'])
  })
})
