import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'

const { mockLoggerLog, mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerLog: vi.fn(), mockLoggerWarn: vi.fn() }))

vi.mock('@src/common/index.js', () => ({
  Logger: vi.fn(
    class {
      log = mockLoggerLog
      warn = mockLoggerWarn
      error = vi.fn()
    },
  ),
}))

const { ESLINT_KILL_GRACE_MS, ESLintBudget, formatGeneratedFiles, lintFile } = await import('@src/util/generator-cli.util.js')

/**
 * The project's ESLint run as a real process: stand-ins in a project of their own, run by this runtime as the CLI runs
 * the real one, each recording its arguments and process ID before running `body`.
 */
describe("the project's ESLint", () => {
  let root: string
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const runs = () => (existsSync(path.join(root, 'runs.json')) ? readFileSync(path.join(root, 'runs.json'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { pid: number; args: string[] }) : [])
  /** An ESLint whose bin records each run, then runs `body`. */
  const eslint = (body: string) => {
    write('node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: { eslint: 'bin.js' } }))
    write(
      'node_modules/eslint/bin.js',
      `const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(require('path').join(__dirname, '..', '..', 'runs.json'), JSON.stringify({ pid: process.pid, args }) + '\\n')
${body}
`,
    )
  }
  /** Writes the report a run of `lintFile` reads, with one error per entry of `rules`. */
  const report = (rules: string[]) =>
    `fs.writeFileSync(args[args.indexOf('--output-file') + 1], JSON.stringify([{ messages: ${JSON.stringify(rules)}.map(ruleId => ({ ruleId, message: 'Wrong', severity: 2 })) }]))`
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  /** Waits up to a second for a stopped process to be gone, as the system removes it. */
  const gone = async (pid: number) => {
    for (let tries = 0; alive(pid) && tries < 50; tries++) await new Promise(resolve => setTimeout(resolve, 20))
    return !alive(pid)
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'meocord-eslint-run-'))
    write('package.json', '{}')
    write('src/a.ts', 'export const a = 1\n')
    vi.spyOn(process, 'cwd').mockReturnValue(root)
    mockLoggerLog.mockClear()
    mockLoggerWarn.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    for (const { pid } of runs()) if (alive(pid)) process.kill(pid, 'SIGKILL')
    rmSync(root, { recursive: true, force: true })
  })

  describe('formatGeneratedFiles', () => {
    // One run builds the project's type information once; a run per file would build it for each
    it("formats every generated file in one run of the project's ESLint, and settles once it has finished", async () => {
      eslint("setTimeout(() => fs.writeFileSync(__dirname + '/../../done', ''), 200)")

      await formatGeneratedFiles(['/src/a.service.ts', '/src/a.service.spec.ts'])

      expect(runs().map(run => run.args)).toEqual([['--fix', '/src/a.service.ts', '/src/a.service.spec.ts']])
      expect(existsSync(path.join(root, 'done'))).toBe(true)
      expect(mockLoggerLog).toHaveBeenCalledWith("Formatting with your project's ESLint...")
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    })

    // The files are written either way: what went wrong is said, and the command's code is left alone
    it.each([
      ['rules it could not fix', 'process.exitCode = 1', 'ESLint reports problems it could not fix; run it on the files to see them.'],
      [
        'an ESLint that could not run, naming the cause after its banner',
        "console.error(\"\\nOops! Something went wrong! :(\\n\\nESLint: 10.11.0\\n\\nError [ERR_MODULE_NOT_FOUND]: Cannot find module './missing.mjs'\\n    at finalizeResolution\\n\"); process.exitCode = 2",
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module './missing.mjs'",
      ],
      ['an ESLint that could not run, with only its first line', "console.error('Invalid option --fixx'); process.exitCode = 2", 'Invalid option --fixx'],
    ])('says it could not format, and keeps a success code, for %s', async (_case, body, reason) => {
      eslint(body)
      const exitCode = process.exitCode
      process.exitCode = undefined

      await formatGeneratedFiles(['/src/a.ts'])

      expect(process.exitCode).toBeUndefined()
      expect(mockLoggerWarn).toHaveBeenCalledWith(`Could not format the generated files: ${reason}`)
      process.exitCode = exitCode
    })

    // Reaching for npx would start downloading ESLint into a project that deliberately has none
    it('runs nothing and says nothing when the project has no ESLint, or nothing was written', async () => {
      await formatGeneratedFiles(['/src/a.ts'])
      eslint('')
      await formatGeneratedFiles([])

      expect(runs()).toEqual([])
      expect(mockLoggerLog).not.toHaveBeenCalled()
    })
  })

  describe('lintFile', () => {
    it('reads the report from the output file, whatever the config prints', async () => {
      eslint(`console.log('Loaded the config'); ${report(['local/rule'])}; process.exitCode = 1`)

      expect(await lintFile(path.join(root, 'src/a.ts'), root)).toEqual({ errors: [{ rule: 'local/rule', message: 'Wrong' }] })
    })

    // On Windows SIGTERM can't be ignored and ends ESLint at once; the time bound and its end hold either way
    it('kills an ESLint that ignores SIGTERM once the grace has passed, and leaves none running', async () => {
      eslint("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")
      const started = Date.now()

      expect(await lintFile(path.join(root, 'src/a.ts'), root, new ESLintBudget(300))).toEqual({ unchecked: 'ESLint did not finish within 0.3 s and was stopped' })
      expect(Date.now() - started).toBeLessThan(300 + ESLINT_KILL_GRACE_MS + 1_000)
      expect(await gone(runs()[0].pid)).toBe(true)
    })

    // What a config starts is its own: ESLint's result is read once ESLint itself exits
    it('returns once ESLint exits, while a process its config started still holds what it inherited', async () => {
      eslint(
        `const sleeper = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], { stdio: 'inherit' })
fs.writeFileSync(__dirname + '/../../sleeper.pid', String(sleeper.pid))
sleeper.unref()
${report([])}`,
      )
      const started = Date.now()

      try {
        expect(await lintFile(path.join(root, 'src/a.ts'), root)).toEqual({ errors: [] })
        expect(Date.now() - started).toBeLessThan(10_000)
      } finally {
        // On Windows the process is ended with ESLint already, as children are by default there
        const sleeper = Number(readFileSync(path.join(root, 'sleeper.pid'), 'utf8'))
        if (alive(sleeper)) process.kill(sleeper, 'SIGKILL')
      }
    })
  })

  // A config that never returns would otherwise cost the limit once per run
  it('starts no run once one was stopped, so a command spends the limit once', async () => {
    eslint('setInterval(() => {}, 1000)')
    const budget = new ESLintBudget(300)
    const started = Date.now()

    await formatGeneratedFiles([path.join(root, 'src/a.ts')], budget)
    const linted = await lintFile(path.join(root, 'src/a.ts'), root, budget)

    expect(mockLoggerWarn).toHaveBeenCalledWith('Could not format the generated files: ESLint did not finish within 0.3 s and was stopped; run it on the files to format them.')
    expect(linted).toEqual({ unchecked: 'ESLint did not finish within 0.3 s and was stopped' })
    expect(runs()).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(300 + ESLINT_KILL_GRACE_MS + 1_000)
  })
})
