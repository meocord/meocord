import { vi } from 'vitest'
import { Argument, Command, Help, Option } from 'commander'

const { mockExistsSync, mockReadFileSync, mockFindModulePackageDir, mockWait } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockFindModulePackageDir: vi.fn(),
  mockWait: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}))

vi.mock('chalk', () => ({
  default: {
    red: (...args: any[]) => args.join(' '),
  },
}))

vi.mock('@src/util/common.util.js', () => ({
  findModulePackageDir: mockFindModulePackageDir,
}))

vi.mock('@src/util/wait.util.js', () => ({
  default: mockWait,
}))

const { formatHelp, generateCommandsTable, generateOptionsTable, generateArgumentsTable, ensureReady } =
  await import('@src/util/meocord-cli.util.js')

describe('generateCommandsTable', () => {
  it('output contains command name and description', () => {
    const cmd = new Command('meocord').description('MeoCord CLI')
    const sub = new Command('new').description('Scaffold a new project')
    cmd.addCommand(sub)

    const output = generateCommandsTable(cmd)
    expect(output).toContain('new')
    expect(output).toContain('Scaffold a new project')
  })

  it('shows dash for commands without aliases', () => {
    const cmd = new Command('meocord')
    const sub = new Command('build').description('Build the project')
    cmd.addCommand(sub)

    const output = generateCommandsTable(cmd)
    expect(output).toContain('—')
  })
})

describe('generateOptionsTable', () => {
  it('output contains option flag and description', () => {
    const helper = new Help()
    const option = new Option('-v, --verbose', 'Enable verbose output')

    const output = generateOptionsTable([option], helper)
    expect(output).toContain('--verbose')
    expect(output).toContain('Enable verbose output')
  })

  it('handles multiple options', () => {
    const helper = new Help()
    const opt1 = new Option('-v, --verbose', 'Enable verbose output')
    const opt2 = new Option('-d, --debug', 'Enable debug mode')

    const output = generateOptionsTable([opt1, opt2], helper)
    expect(output).toContain('--verbose')
    expect(output).toContain('--debug')
  })
})

describe('generateArgumentsTable', () => {
  it('output contains argument name', () => {
    const arg = new Argument('<name>', 'The project name')

    const output = generateArgumentsTable([arg])
    expect(output).toContain('name')
    expect(output).toContain('The project name')
  })

  it('includes choices section when argChoices are present', () => {
    const arg = new Argument('<template>', 'Project template').choices(['basic', 'advanced'])

    const output = generateArgumentsTable([arg])
    expect(output).toContain('Available Choices')
    expect(output).toContain('basic')
    expect(output).toContain('advanced')
  })

  it('leaves the choices section out when no argument has choices', () => {
    const arg = new Argument('<name>', 'The project name')

    const output = generateArgumentsTable([arg])
    expect(output).not.toMatch(/choices/i)
    expect(output).toContain('Available Arguments')
  })
})

describe('formatHelp', () => {
  it('output starts with the MeoCord copyright banner', () => {
    const cmd = new Command('meocord').description('The MeoCord CLI')
    const helper = new Help()

    const output = formatHelp(cmd, helper, [])
    expect(output).toContain('MeoCord Copyright (c) 2025')
  })

  it('includes command usage', () => {
    const cmd = new Command('meocord').description('The MeoCord CLI')
    const helper = new Help()

    const output = formatHelp(cmd, helper, [])
    expect(output).toContain(helper.commandUsage(cmd))
  })

  it('includes command description', () => {
    const cmd = new Command('meocord').description('The MeoCord CLI')
    const helper = new Help()

    const output = formatHelp(cmd, helper, [])
    expect(output).toContain('The MeoCord CLI')
  })

  it('includes options table when options are provided', () => {
    const cmd = new Command('meocord').description('The MeoCord CLI')
    const helper = new Help()
    const option = new Option('-v, --verbose', 'Verbose output')

    const output = formatHelp(cmd, helper, [option])
    expect(output).toContain('Available Options')
    expect(output).toContain('--verbose')
  })

  it('includes commands table when subcommands are present', () => {
    const cmd = new Command('meocord').description('The MeoCord CLI')
    const sub = new Command('new').description('Scaffold a new project')
    cmd.addCommand(sub)
    const helper = new Help()

    const output = formatHelp(cmd, helper, [])
    expect(output).toContain('Available Commands')
    expect(output).toContain('new')
  })
})

describe('ensureReady', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
    mockFindModulePackageDir.mockReset()
    mockWait.mockClear()
  })

  it('exits if package.json not found', async () => {
    mockFindModulePackageDir.mockReturnValue('/some/path/meocord')
    mockExistsSync.mockReturnValue(false)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureReady()

    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('exits if findModulePackageDir returns null', async () => {
    mockFindModulePackageDir.mockReturnValue(null)
    mockExistsSync.mockReturnValue(true)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureReady()

    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('exits if meocord is not listed in dependencies', async () => {
    mockFindModulePackageDir.mockReturnValue('/some/path/meocord')
    mockExistsSync.mockReturnValue(true)

    mockReadFileSync.mockImplementation((p: unknown) => {
      // Normalised because the code under test joins paths with the platform separator,
      // and a Windows backslash would not match the POSIX fixture below.
      const pathStr = String(p).replaceAll('\\', '/')
      if (pathStr.includes('/some/path/meocord')) {
        return JSON.stringify({ name: 'meocord' }) as any
      }
      return JSON.stringify({ dependencies: { 'other-package': '^1.0.0' } }) as any
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureReady()

    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  // A package.json saved with a byte order mark, as a Windows editor writes one, which Node and npm read
  it('reads a package.json saved with a byte order mark', async () => {
    mockFindModulePackageDir.mockReturnValue('/some/path/meocord')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation((p: unknown) =>
      String(p).replaceAll('\\', '/').includes('/some/path/meocord')
        ? JSON.stringify({ name: 'meocord' })
        : `\uFEFF${JSON.stringify({ dependencies: { meocord: '^1.0.0' } })}`,
    )
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureReady()

    expect(consoleSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('resolves without exit when all checks pass', async () => {
    mockFindModulePackageDir.mockReturnValue('/some/path/meocord')
    mockExistsSync.mockReturnValue(true)
    mockWait.mockResolvedValue(undefined)

    mockReadFileSync.mockImplementation((p: unknown) => {
      // Normalised because the code under test joins paths with the platform separator,
      // and a Windows backslash would not match the POSIX fixture below.
      const pathStr = String(p).replaceAll('\\', '/')
      if (pathStr.includes('/some/path/meocord')) {
        return JSON.stringify({ name: 'meocord' }) as any
      }
      return JSON.stringify({ dependencies: { meocord: '^1.0.0' } }) as any
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureReady()

    expect(exitSpy).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    consoleSpy.mockRestore()
  })
})
