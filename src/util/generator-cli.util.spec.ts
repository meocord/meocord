import path from 'path'
import { vi } from 'vitest'

const { mockExistsSync, mockMkdirSync, mockWriteFileSync, mockReadFileSync, mockExecFile, mockLoggerLog, mockLoggerError, mockLoggerWarn } =
  vi.hoisted(() => ({
    mockLoggerWarn: vi.fn(),
    mockExistsSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockExecFile: vi.fn(),
    mockLoggerLog: vi.fn(),
    mockLoggerError: vi.fn(),
  }))

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}))

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

// Logger is constructed with `new`, so the implementation has to be a class or
// function — vitest 4 refuses to construct an arrow. The shared log/error mocks
// stay shared: every instance points at the same two functions.
vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = mockLoggerLog
      error = mockLoggerError
      warn = mockLoggerWarn
      info = vi.fn()
      debug = vi.fn()
      verbose = vi.fn()
    },
  ),
}))

const {
  toClassName,
  validateAndFormatName,
  commandNameFor,
  assertFilesAbsent,
  createDirectoryIfNotExists,
  generateFile,
  writeFiles,
  formatGeneratedFiles,
  buildTemplate,
  populateTemplate,
} = await import('@src/util/generator-cli.util.js')

describe('toClassName', () => {
  it('converts camelCase to PascalCase class name', () => {
    expect(toClassName('myController')).toBe('MyController')
  })

  it('converts kebab-case to PascalCase class name', () => {
    expect(toClassName('my-guard')).toBe('MyGuard')
  })

  it('calls process.exit for invalid names like "123invalid"', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    toClassName('123invalid')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})

describe('validateAndFormatName', () => {
  it('returns correct parts, kebabCaseName, and className for a simple name', () => {
    const result = validateAndFormatName('MyGuard')
    expect(result.parts).toEqual([])
    expect(result.kebabCaseName).toBe('my-guard')
    expect(result.className).toBe('MyGuard')
  })

  it('returns correct parts array for a nested path', () => {
    const result = validateAndFormatName('subdir/MyGuard')
    expect(result.parts).toEqual(['subdir'])
    expect(result.kebabCaseName).toBe('my-guard')
    // The whole path, so a nested name and a flat one never make two classes of one name
    expect(result.className).toBe('SubdirMyGuard')
    expect(validateAndFormatName('admin/users/ban').className).toBe('AdminUsersBan')
  })

  it('calls process.exit when name is undefined', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    try {
      validateAndFormatName(undefined)
    } catch {
      // process.exit is mocked; execution may continue past the guard and throw
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  // Shared by every generator, so the message names no kind of component
  it('names no particular kind of component when the name is missing', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    mockLoggerError.mockClear()

    try {
      validateAndFormatName(undefined)
    } catch {
      // process.exit is mocked
    }

    expect(mockLoggerError).toHaveBeenCalledWith('A name is required.')
    exitSpy.mockRestore()
  })

  it('derives the command name from the whole path', () => {
    expect(validateAndFormatName('Greeting').commandName).toBe('greeting')
    expect(validateAndFormatName('admin/banUser').commandName).toBe('admin-ban-user')
  })
})

describe('commandNameFor', () => {
  it('uses the name alone when it is not nested', () => {
    expect(commandNameFor([], 'greeting')).toBe('greeting')
  })

  // Discord command names are global to the application; folders only keep files apart.
  it('joins every folder into the name, kebab-cased', () => {
    expect(commandNameFor(['admin', 'userTools'], 'ban')).toBe('admin-user-tools-ban')
  })
})

describe('assertFilesAbsent', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockLoggerError.mockClear()
  })

  it('lets generation proceed when none of the files exist', () => {
    mockExistsSync.mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    assertFilesAbsent(['/app/src/a.ts', '/app/src/b.ts'])

    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('stops before anything is written, naming every file that exists', () => {
    mockExistsSync.mockImplementation((file: string) => file.endsWith('b.ts') || file.endsWith('c.ts'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    assertFilesAbsent(['a.ts', 'b.ts', 'c.ts'].map(file => path.join(process.cwd(), 'src', file)))

    expect(exitSpy).toHaveBeenCalledWith(1)
    const message = mockLoggerError.mock.calls.at(-1)?.[0] as string
    expect(message).toContain('Refusing to overwrite existing files')
    expect(message).toContain('b.ts')
    expect(message).toContain('c.ts')
    expect(message).not.toContain('a.ts')
    expect(message).toContain('Nothing was generated')
    exitSpy.mockRestore()
  })
})

describe('createDirectoryIfNotExists', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockMkdirSync.mockReset()
  })

  it('calls mkdirSync when directory does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    createDirectoryIfNotExists('/some/new/dir')
    expect(mockMkdirSync).toHaveBeenCalledWith('/some/new/dir', { recursive: true })
  })

  it('does NOT call mkdirSync when directory already exists', () => {
    mockExistsSync.mockReturnValue(true)
    createDirectoryIfNotExists('/some/existing/dir')
    expect(mockMkdirSync).not.toHaveBeenCalled()
  })
})

describe('generateFile', () => {
  beforeEach(() => {
    mockWriteFileSync.mockReset()
    mockExecFile.mockReset()
    mockExistsSync.mockReset()
  })

  // `wx` fails rather than replaces: an existing file is never overwritten, whatever called this.
  it('writes the file exclusively, so it can never replace one, and says it did', () => {
    expect(generateFile('/some/file.ts', 'export const x = 1')).toBe(true)
    expect(mockWriteFileSync).toHaveBeenCalledWith('/some/file.ts', 'export const x = 1', { flag: 'wx' })
  })

  it('leaves an existing file alone and reports failure rather than success', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    })
    mockLoggerLog.mockClear()
    mockLoggerError.mockClear()
    const exitCode = process.exitCode

    expect(generateFile(path.join(process.cwd(), 'src', 'file.ts'), 'content')).toBe(false)

    expect(process.exitCode).toBe(1)
    // Named relative to the project, with the platform's own separator.
    expect(mockLoggerError).toHaveBeenCalledWith(`${path.join('src', 'file.ts')} already exists; left it untouched.`)
    expect(mockLoggerLog).not.toHaveBeenCalledWith(expect.stringContaining('Created'))
    process.exitCode = exitCode
  })

  // A generation that wrote nothing must not end with a success status.
  it('sets a failing exit code when the write fails for any other reason', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    const exitCode = process.exitCode

    generateFile('/some/file.ts', 'content')

    expect(process.exitCode).toBe(1)
    process.exitCode = exitCode
  })

  it('writes each file in order, and returns those it wrote', () => {
    mockWriteFileSync.mockImplementation((file: string) => {
      if (file === '/b.ts') throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    })
    const exitCode = process.exitCode

    expect(writeFiles([['/a.ts', 'a'], ['/b.ts', 'b'], ['/c.ts', 'c']])).toEqual(['/a.ts', '/c.ts'])
    process.exitCode = exitCode
  })
})

describe('formatGeneratedFiles', () => {
  const ESLINT_MANIFEST = JSON.stringify({ name: 'eslint', bin: { eslint: './bin/eslint.js' } })
  const eslintScript = () => path.resolve(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js')
  type Done = (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void
  const eslintExits = (error: (Error & { code?: number }) | null, stderr = '') =>
    mockExecFile.mockImplementation((_file: string, _args: string[], done: Done) => done(error, '', stderr))

  beforeEach(() => {
    mockExecFile.mockReset()
    mockExistsSync.mockReset().mockReturnValue(true)
    mockReadFileSync.mockReset().mockReturnValue(ESLINT_MANIFEST as any)
    mockLoggerLog.mockClear()
    mockLoggerWarn.mockClear()
  })

  // One run builds the project's type information once; a run per file would build it for each
  // On Windows a .cmd shim can't be spawned without a shell, so the script runs with this runtime there too.
  it.each(['linux', 'win32'])("formats every generated file in one run of the project's eslint, by this runtime, on %s", async platform => {
    const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform)
    eslintExits(null)

    await formatGeneratedFiles(['/src/a.service.ts', '/src/a.service.spec.ts'])
    spy.mockRestore()

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(mockExecFile).toHaveBeenCalledWith(
      process.execPath,
      [eslintScript(), '--fix', '/src/a.service.ts', '/src/a.service.spec.ts'],
      expect.any(Function),
    )
    expect(mockLoggerLog).toHaveBeenCalledWith("Formatting with your project's ESLint...")
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  // The command waits for it, so it ends once the files are formatted, and no later
  it('settles only once the eslint run has finished', async () => {
    let finish: () => void = () => {}
    mockExecFile.mockImplementation((_file: string, _args: string[], done: Done) => (finish = () => done(null, '', '')))
    let settled = false

    const formatting = formatGeneratedFiles(['/src/a.ts']).then(() => (settled = true))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    finish()
    await formatting
    expect(settled).toBe(true)
  })

  // The files are written either way: what went wrong is said, and the command's code is left alone
  it.each([
    ['rules it could not fix', () => eslintExits(Object.assign(new Error('Command failed'), { code: 1 })), 'ESLint reports problems it could not fix'],
    [
      'eslint that could not run, naming the cause after its banner',
      () =>
        eslintExits(
          Object.assign(new Error('Command failed'), { code: 2 }),
          "\nOops! Something went wrong! :(\n\nESLint: 10.11.0\n\nError [ERR_MODULE_NOT_FOUND]: Cannot find module './missing.mjs'\n    at finalizeResolution\n",
        ),
      "Error \\[ERR_MODULE_NOT_FOUND\\]: Cannot find module './missing.mjs'",
    ],
    ['eslint that could not run, with only its first line', () => eslintExits(Object.assign(new Error('Command failed'), { code: 2 }), 'Invalid option --fixx\n'), 'Invalid option --fixx'],
    ['a spawn that throws', () => mockExecFile.mockImplementation(() => { throw new Error('spawn EINVAL') }), 'spawn EINVAL'],
  ])('says it could not format, and keeps a success code, for %s', async (_case, fail, reason) => {
    fail()
    const exitCode = process.exitCode
    process.exitCode = undefined

    await formatGeneratedFiles(['/src/a.ts'])

    expect(process.exitCode).toBeUndefined()
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^Could not format the generated files: ${reason}`)))
    process.exitCode = exitCode
  })

  // Reaching for npx would start downloading eslint into a project that deliberately has none
  it('runs nothing and says nothing when the project has no eslint, or nothing was written', async () => {
    mockExistsSync.mockReturnValue(false)
    await formatGeneratedFiles(['/src/a.ts'])
    mockExistsSync.mockReturnValue(true)
    await formatGeneratedFiles([])

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(mockLoggerLog).not.toHaveBeenCalled()
  })
})

describe('buildTemplate', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset()
  })

  it('calls readFileSync with a path containing the template file name', () => {
    mockReadFileSync.mockReturnValue('class {{className}} {}' as any)

    buildTemplate('MyService', 'service.template.ts')

    expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining('service.template.ts'), 'utf-8')
  })

  it('replaces {{className}} placeholder with the provided class name', () => {
    mockReadFileSync.mockReturnValue('class {{className}} {}' as any)

    const result = buildTemplate('MyService', 'service.template.ts')

    expect(result).toBe('class MyService {}')
  })
})

describe('populateTemplate', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset()
  })

  it('replaces all {{variable}} placeholders in the template', () => {
    mockReadFileSync.mockReturnValue('Hello {{name}}, your role is {{role}}.' as any)

    const result = populateTemplate('/template/path.ts', { name: 'Alice', role: 'admin' })

    expect(result).toBe('Hello Alice, your role is admin.')
  })

  it('replaces multiple occurrences of the same placeholder', () => {
    mockReadFileSync.mockReturnValue('{{name}} is {{name}}.' as any)

    const result = populateTemplate('/template/path.ts', { name: 'Bob' })

    expect(result).toBe('Bob is Bob.')
  })
})
