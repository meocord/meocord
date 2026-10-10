import { vi } from 'vitest'
import path from 'path'

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockReadSourceConfig,
  mockWait,
  mockLoadCompiledConfig,
  mockCompiledProblem,
} = vi.hoisted(() => ({
  mockReadSourceConfig: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockWait: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockLoadCompiledConfig: vi.fn(),
  mockCompiledProblem: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}))

vi.mock('chalk', () => ({
  default: {
    red: (...args: any[]) => args.join(' '),
    yellow: (...args: any[]) => args.join(' '),
  },
}))

vi.mock('@src/util/meocord-source-config.util.js', () => ({
  readMeoCordSourceConfig: mockReadSourceConfig,
}))

vi.mock('@src/util/meocord-config-loader.util.js', () => ({
  loadMeoCordConfig: mockLoadCompiledConfig,
  compiledConfigProblem: mockCompiledProblem,
  compiledConfigMessage: () => 'MeoCord config at dist/meocord.config.mjs failed to load: boom. Fix meocord.config.ts, then run `meocord build`.',
}))

vi.mock('@src/util/wait.util.js', () => ({
  default: mockWait,
}))

const { findModulePackageDir, compileAndValidateConfig, setEnvironment, validateDiscordToken, validateRunConfig } = await import(
  '@src/util/common.util.js',
)

describe('setEnvironment', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('sets process.env.NODE_ENV when not already set', () => {
    delete process.env.NODE_ENV
    setEnvironment('development')
    expect(process.env.NODE_ENV).toBe('development')
  })

  it('keeps a NODE_ENV the shell set for production, and replaces it for development', () => {
    process.env.NODE_ENV = 'staging'
    setEnvironment('production')
    expect(process.env.NODE_ENV).toBe('staging')
    setEnvironment('development')
    expect(process.env.NODE_ENV).toBe('development')
  })
})

describe('findModulePackageDir', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
  })

  it('returns the module path when found in node_modules at baseDir', () => {
    const baseDir = '/some/project'
    const moduleName = 'lodash'
    const expectedPath = path.join(baseDir, 'node_modules', moduleName)

    mockExistsSync.mockImplementation((p: unknown) => p === expectedPath)

    const result = findModulePackageDir(moduleName, baseDir)
    expect(result).toBe(expectedPath)
  })

  // A project at the filesystem root, as in a container's /app parent, keeps its packages in /node_modules
  it('finds a module in the filesystem root\'s node_modules', () => {
    const root = path.parse(process.cwd()).root
    const expectedPath = path.join(root, 'node_modules', 'meocord')
    mockExistsSync.mockImplementation((p: unknown) => p === expectedPath)

    expect(findModulePackageDir('meocord', path.join(root, 'app', 'bot'))).toBe(expectedPath)
  })

  it('returns null when module is not found after full traversal', () => {
    mockExistsSync.mockReturnValue(false)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = findModulePackageDir('nonexistent-module', '/tmp')
    consoleSpy.mockRestore()

    expect(result).toBeNull()
  })
})

// `meocord start --prod` without --build runs whatever was built, or finds nothing to run
describe('validateRunConfig', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadSourceConfig.mockReset()
    mockLoadCompiledConfig.mockReset()
    mockCompiledProblem.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('checks the compiled config when there is one', async () => {
    mockLoadCompiledConfig.mockReturnValue({ discordToken: 't', shutdownTimeout: 'soon' })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateRunConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('shutdownTimeout must be a number'))
    expect(mockReadSourceConfig).not.toHaveBeenCalled()
  })

  // A broken one is what the bot would run; meocord.config.ts would pass, and the bot would stop without saying why
  it('stops at a compiled config that fails to load, with why, rather than check meocord.config.ts', async () => {
    mockLoadCompiledConfig.mockReturnValue(undefined)
    mockCompiledProblem.mockReturnValue({ path: 'dist/meocord.config.mjs', missing: false, error: new Error('boom') })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateRunConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleSpy.mock.calls.map(([message]) => String(message))).toEqual([
      'MeoCord config at dist/meocord.config.mjs failed to load: boom. Fix meocord.config.ts, then run `meocord build`.',
    ])
    expect(mockReadSourceConfig).not.toHaveBeenCalled()
  })

  // The token check that follows reads what this returns, so it checks the config the bot runs with
  it('returns the compiled config the bot will run with, and the source only when none was compiled', async () => {
    mockLoadCompiledConfig.mockReturnValue({ discordToken: 'compiled' })
    expect(await validateRunConfig()).toEqual({ discordToken: 'compiled' })
    expect(mockReadSourceConfig).not.toHaveBeenCalled()

    mockLoadCompiledConfig.mockReturnValue(undefined)
    mockCompiledProblem.mockReturnValue({ path: 'dist/meocord.config.mjs', missing: true })
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ config: { discordToken: 'source' } })
    expect(await validateRunConfig()).toEqual({ discordToken: 'source' })
  })

  it('says the config is missing, not that it exports nothing, when there is none at all', async () => {
    mockLoadCompiledConfig.mockReturnValue(undefined)
    mockExistsSync.mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateRunConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleSpy.mock.calls.map(([message]) => String(message))).toEqual([
      'Configuration file "meocord.config.ts" is missing!',
    ])
  })

  it('reports a source that fails to load once, with the loader’s message', async () => {
    mockLoadCompiledConfig.mockReturnValue(undefined)
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ error: 'ParseError: Unexpected token  meocord.config.ts:4:0' })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateRunConfig()

    expect(exitSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('meocord.config.ts:4:0'))
  })
})

describe('compileAndValidateConfig', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadSourceConfig.mockReset()
    mockWait.mockClear()
  })

  it('exits, with the loader\'s message, when meocord.config.ts cannot be loaded', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ error: 'ParseError: Unexpected token  meocord.config.ts:2:0' })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('meocord.config.ts:2:0'))
    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('exits, listing every problem, when options have the wrong type', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ config: { discordToken: 't', sharding: { mode: 'bogus' }, shutdownTimeout: 'soon' } })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('has 2 problem(s)'))
    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('warns about an unknown option and carries on', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ config: { discordToken: 't', bundleDependancies: true } })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bundleDependancies is not a MeoCord option'))
    exitSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('calls process.exit(1) when meocord.config.ts does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    mockWait.mockResolvedValue(undefined)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  // Producing a bundle needs no credentials, so a configuration without a token is not a
  // reason to refuse to build.
  it('does not call process.exit when only the token is missing', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ config: { appName: 'TestApp' } })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('does not call process.exit when config is valid', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadSourceConfig.mockReturnValue({ config: { discordToken: 'valid-token' } })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await compileAndValidateConfig()

    expect(exitSpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })
})

// Starting the bot or registering its commands is where a token is required
describe('validateDiscordToken', () => {
  beforeEach(() => {
    mockWait.mockClear()
  })

  it('calls process.exit(1) when the token is missing', async () => {
    mockWait.mockResolvedValue(undefined)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateDiscordToken({ discordToken: '' })

    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('does not call process.exit when a token is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await validateDiscordToken({ discordToken: 'valid-token' })

    expect(exitSpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })
})
