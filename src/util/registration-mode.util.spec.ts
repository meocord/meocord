import { REGISTER_MODE_ENV, registersAsDevelopment } from '@src/util/registration-mode.util.js'

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
