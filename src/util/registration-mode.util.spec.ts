import {
  FORCE_REGISTER_ENV,
  isRegisterOnly,
  PRUNE_ENV,
  pruneRequestOf,
  REGISTER_GUILD_ENV,
  REGISTER_MODE_ENV,
  REGISTER_ONLY_ENV,
  registerGuildOf,
  registersAsDevelopment,
} from '@src/util/registration-mode.util.js'

// The CLI blanks each variable a run's flags do not set, so a blank one reads as not given
describe('a blank variable from the CLI', () => {
  it('asks for no register-only run, guild, forced send or prune', () => {
    const env = { [REGISTER_ONLY_ENV]: '', [REGISTER_GUILD_ENV]: '', [FORCE_REGISTER_ENV]: '', [PRUNE_ENV]: '' }

    expect(isRegisterOnly(env)).toBe(false)
    expect(registerGuildOf(env)).toBeUndefined()
    expect(pruneRequestOf(env)).toBeUndefined()
  })

  it('reads a guild the CLI gives', () => {
    expect(registerGuildOf({ [REGISTER_GUILD_ENV]: '111111111111111111' })).toBe('111111111111111111')
  })
})

describe('registersAsDevelopment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // The CLI's mode wins over NODE_ENV, which a bundle has written in as the mode it was built in
  it.each([
    ['development', 'production', true],
    ['production', 'development', false],
  ])('registers as %s when the CLI says so, whatever NODE_ENV (%s) holds', (mode, nodeEnv, development) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    expect(registersAsDevelopment({ [REGISTER_MODE_ENV]: mode })).toBe(development)
  })

  it.each([
    ['development', true],
    ['production', false],
  ])('goes by NODE_ENV=%s for a bot the CLI did not start', (nodeEnv, development) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    expect(registersAsDevelopment({})).toBe(development)
  })
})
