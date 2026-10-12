import { vi } from 'vitest'
import path from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdtempSync, mockReaddirSync, mockRmSync, mockHostname, mockReadlinkSync } =
  vi.hoisted(() => {
  let made = 0
  return {
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    // A fresh directory per call, as the real one makes
    mockMkdtempSync: vi.fn((prefix: string) => `${prefix}${++made}`),
    mockReaddirSync: vi.fn((): string[] => []),
    mockRmSync: vi.fn(),
    // A '-' in the name, which a directory name can't carry between its fields
    mockHostname: vi.fn(() => 'build-01.local'),
    // As outside Linux, where there is no /proc
    mockReadlinkSync: vi.fn((): string => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
  }
})

// get-tsconfig reads the real files, which these cases mock; what it gives is covered in tsconfig-paths.util.spec
vi.mock('@src/util/tsconfig-paths.util.js', () => ({ resolutionTsconfig: () => ({ compilerOptions: {} }) }))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdtempSync: mockMkdtempSync,
  readdirSync: mockReaddirSync,
  readlinkSync: mockReadlinkSync,
  rmSync: mockRmSync,
}))

vi.mock('os', async importOriginal => ({ ...(await importOriginal<typeof import('os')>()), hostname: mockHostname }))

const { prepareModifiedTsConfig } = await import('@src/util/tsconfig.util.js')

// The module as a new process loads it, before it has made its directory
async function freshModule() {
  vi.resetModules()
  return import('@src/util/tsconfig.util.js')
}

function mockTsConfig(config: object) {
  mockExistsSync.mockReturnValue(true)
  mockReadFileSync.mockReturnValue(JSON.stringify(config) as any)
}

describe('prepareModifiedTsConfig', () => {
  const exitListeners = process.listeners('exit')

  afterEach(() => {
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.includes(listener)) process.off('exit', listener)
    }
  })

  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
    mockWriteFileSync.mockReset()
    mockRmSync.mockReset()
  })

  it('throws when tsconfig.json does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(() => prepareModifiedTsConfig()).toThrow('tsconfig.json not found')
  })

  it('writes to the temp directory and returns that path', () => {
    mockTsConfig({ compilerOptions: {} })

    const result = prepareModifiedTsConfig()

    expect(result).toContain(tmpdir())
    expect(path.basename(result)).toMatch(/^modified-tsconfig-\d+\.json$/)
    expect(mockWriteFileSync).toHaveBeenCalledWith(result, expect.any(String))
  })

  // Two builds at once, such as CI jobs sharing a runner, would otherwise write over each other's file
  it('gives each call a file of its own', () => {
    mockTsConfig({ compilerOptions: {} })

    const first = prepareModifiedTsConfig()
    const second = prepareModifiedTsConfig()

    expect(first).not.toBe(second)
    expect(path.dirname(first)).toContain(path.join(tmpdir(), 'meocord-tsconfig-'))
  })

  // A watch session copies the file on every reload, and each exit hook would hold a directory until it ends
  it('writes every copy in one directory, removed by one exit hook', async () => {
    mockTsConfig({ compilerOptions: {} })
    const { prepareModifiedTsConfig } = await freshModule()
    const exitListeners = process.listeners('exit')

    const files = Array.from({ length: 12 }, () => prepareModifiedTsConfig())

    expect(new Set(files).size).toBe(12)
    expect(new Set(files.map(file => path.dirname(file))).size).toBe(1)
    expect(process.listeners('exit').filter(listener => !exitListeners.includes(listener))).toHaveLength(1)
  })

  it('removes its directory when the process exits', async () => {
    mockTsConfig({ compilerOptions: {} })
    const { prepareModifiedTsConfig } = await freshModule()
    const exitListeners = process.listeners('exit')

    const file = prepareModifiedTsConfig()
    const cleanup = process.listeners('exit').find(listener => !exitListeners.includes(listener))!
    process.off('exit', cleanup)
    cleanup(0)

    expect(mockRmSync).toHaveBeenCalledWith(path.dirname(file), { recursive: true, force: true })
  })

  it('names its directory for this host and process', async () => {
    mockTsConfig({ compilerOptions: {} })
    const { prepareModifiedTsConfig } = await freshModule()

    const dir = path.basename(path.dirname(prepareModifiedTsConfig()))

    expect(dir).toMatch(new RegExp(`^meocord-tsconfig-build_01\\.local-${process.pid}-`))
  })

  it("keeps a long host's directory name within what a file system allows", async () => {
    mockTsConfig({ compilerOptions: {} })
    mockHostname.mockReturnValueOnce(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`)
    const { prepareModifiedTsConfig } = await freshModule()

    const dir = path.basename(path.dirname(prepareModifiedTsConfig()))

    expect(dir).toMatch(new RegExp(`^meocord-tsconfig-a{63}\\.-${process.pid}-`))
  })

  // Two containers can share a host name and a temp directory, while each numbers its processes on its own
  it("on Linux, judges only its own PID namespace's directories", async () => {
    mockTsConfig({ compilerOptions: {} })
    mockReadlinkSync.mockReturnValueOnce('pid:[4026531836]')
    const ended = spawnSync(process.execPath, ['-e', '0']).pid!
    const left = `meocord-tsconfig-build_01.local_4026531836-${ended}-a1b2c3`
    const kept = [`meocord-tsconfig-build_01.local_4026532999-${ended}-d4e5f6`, `meocord-tsconfig-build_01.local-${ended}-g7h8i9`]
    mockReaddirSync.mockReturnValueOnce([left, ...kept])
    mockRmSync.mockClear()

    const { prepareModifiedTsConfig } = await freshModule()
    const dir = path.basename(path.dirname(prepareModifiedTsConfig()))

    expect(mockRmSync.mock.calls).toEqual([[path.join(tmpdir(), left), { recursive: true, force: true }]])
    expect(dir).toMatch(new RegExp(`^meocord-tsconfig-build_01\\.local_4026531836-${process.pid}-`))
  })

  // A process killed, or one that crashes, never runs its exit hook, and its directory would stay forever
  it("removes a directory this host's ended process left, and keeps the rest", async () => {
    mockTsConfig({ compilerOptions: {} })
    const host = 'build_01.local'
    const ended = spawnSync(process.execPath, ['-e', '0']).pid!
    const left = `meocord-tsconfig-${host}-${ended}-a1b2c3`
    const kept = [
      `meocord-tsconfig-${host}-${process.ppid}-d4e5f6`,
      `meocord-tsconfig-another.host-${ended}-g7h8i9`,
      'meocord-tsconfig-j0k1l2',
      'unrelated',
    ]
    mockReaddirSync.mockReturnValueOnce([left, ...kept])
    mockRmSync.mockClear()

    const { prepareModifiedTsConfig } = await freshModule()
    prepareModifiedTsConfig()

    expect(mockRmSync.mock.calls).toEqual([[path.join(tmpdir(), left), { recursive: true, force: true }]])
    expect(mockReaddirSync).toHaveBeenLastCalledWith(tmpdir())
  })

  it('reads the comments, trailing commas and $schema URL tsconfig.json allows', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(`{
  "$schema": "https://json.schemastore.org/tsconfig", // the editor's schema
  /* the tools' own project */
  "references": [{ "path": "./tools" },],
}` as any)

    prepareModifiedTsConfig()

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string)
    expect(written.references).toEqual([{ path: path.resolve(process.cwd(), 'tools') }])
  })

  it('reads a tsconfig.json saved with a byte order mark, as tsc does', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(`\uFEFF${JSON.stringify({ references: [{ path: './tools' }] })}` as any)

    prepareModifiedTsConfig()

    expect(JSON.parse(mockWriteFileSync.mock.calls[0][1] as string).references).toEqual([{ path: path.resolve(process.cwd(), 'tools') }])
  })

  // Rewriting the project's tsconfig.json would drop the user's comments
  it("never writes the project's tsconfig.json, however it is formatted", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{ // mine\n "compilerOptions": { "noEmit": true, }, }' as any)

    const copy = prepareModifiedTsConfig()

    expect(mockWriteFileSync.mock.calls.map(([file]) => file)).toEqual([copy])
  })

  it('names the file and the fix when tsconfig.json cannot be parsed', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{ compilerOptions: }' as any)

    expect(() => prepareModifiedTsConfig()).toThrow(/Could not parse tsconfig.json in .*Fix the JSON, then build again/)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })
})
