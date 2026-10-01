import path from 'path'
import { vi } from 'vitest'

const { mockExistsSync, mockMkdirSync, mockWriteFileSync, mockReadFileSync, mockExecFile, mockLoggerLog, mockLoggerError } =
  vi.hoisted(() => ({
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
      warn = vi.fn()
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

  // Shared by controllers, services and guards, so the message names none of them.
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
  it('writes the file exclusively, so it can never replace one', () => {
    generateFile('/some/file.ts', 'export const x = 1')
    expect(mockWriteFileSync).toHaveBeenCalledWith('/some/file.ts', 'export const x = 1', { flag: 'wx' })
  })

  it('leaves an existing file alone and reports failure rather than success', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw Object.assign(new Error('exists'), { code: 'EEXIST' })
    })
    mockLoggerLog.mockClear()
    mockLoggerError.mockClear()
    const exitCode = process.exitCode

    generateFile(path.join(process.cwd(), 'src', 'file.ts'), 'content')

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

  const ESLINT_MANIFEST = JSON.stringify({ name: 'eslint', bin: { eslint: './bin/eslint.js' } })
  const eslintScript = () => path.resolve(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js')

  // A project with its own rules still gets them applied to what was generated.
  it("formats with the project's own eslint when it has one, run by this runtime", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(ESLINT_MANIFEST as any)

    generateFile('/some/file.ts', 'content')

    expect(mockExecFile).toHaveBeenCalledWith(process.execPath, [eslintScript(), '--fix', '/some/file.ts'], expect.any(Function))
  })

  // A .cmd shim can't be spawned without a shell, so on Windows it threw EINVAL
  it('never spawns a .cmd shim, on Windows either', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(ESLINT_MANIFEST as any)

    generateFile('/some/file.ts', 'content')
    platform.mockRestore()

    expect(mockExecFile).toHaveBeenCalledWith(process.execPath, [eslintScript(), '--fix', '/some/file.ts'], expect.any(Function))
  })

  // The file is written by then: a format that cannot even start must not report it as failed
  it('reports the file created, and keeps a success code, when formatting throws', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(ESLINT_MANIFEST as any)
    mockExecFile.mockImplementationOnce(() => {
      throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' })
    })
    const exitCode = process.exitCode
    process.exitCode = undefined

    generateFile('/some/file.ts', 'content')

    expect(process.exitCode).toBeUndefined()
    expect(mockLoggerLog).toHaveBeenCalledWith(`Created ${path.relative(process.cwd(), '/some/file.ts')}`)
    expect(mockLoggerError).not.toHaveBeenCalled()
    process.exitCode = exitCode
  })

  // Reaching for npx would start downloading eslint into a project that deliberately
  // has none, once per generated file, and the call is not awaited so nothing shows it.
  it('does not reach for eslint when the project has none', () => {
    mockExistsSync.mockReturnValue(false)

    generateFile('/some/file.ts', 'content')

    expect(mockExecFile).not.toHaveBeenCalled()
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
