import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { boundedStep, eslintScriptOf, isRunning, mustRun } from './packed-app.js'

let root: string

/** Node code that starts a process which waits, writes its pid to `pidFile`, and waits too. */
const startsOne = (pidFile: string) =>
  `const { spawn } = require('child_process'); const fs = require('fs');` +
  `const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });` +
  `fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 60_000)`

/** Waits for a process to be gone, as init reaps one another has outlived a moment after the signal. */
async function gone(pid: number): Promise<boolean> {
  for (let waited = 0; isRunning(pid) && waited < 2_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
  return !isRunning(pid)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-packed-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a setup step', () => {
  it('stops one that outlasts its budget, naming the step and how long it ran', () => {
    const started = Date.now()

    expect(() => mustRun('wait forever', process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], root, undefined, 300)).toThrow(
      /^wait forever did not finish within its 0\.3s budget, stopped at \d+\.\ds \(/,
    )
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it('stops every process the step started, not the step alone', async () => {
    const pidFile = path.join(root, 'grandchild.pid')

    expect(() => mustRun('start one and wait', process.execPath, ['-e', startsOne(pidFile)], root, undefined, 1_000)).toThrow(/did not finish within its 1s budget/)
    expect(existsSync(pidFile)).toBe(true)
    expect(await gone(Number(readFileSync(pidFile, 'utf8')))).toBe(true)
  })

  // A terminal's Ctrl+C signals its foreground group, which the step, in a group of its own, is not in
  it.skipIf(process.platform === 'win32')("stops every process the step started when its caller's group is stopped", async () => {
    const pidFile = path.join(root, 'grandchild.pid')
    const runner = spawn(process.execPath, [boundedStep, '60000', 'direct', process.execPath, '-e', startsOne(pidFile)], { detached: true, stdio: 'ignore' })
    for (let waited = 0; !existsSync(pidFile) && waited < 10_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
    const exited = new Promise<number | null>(resolve => runner.once('exit', code => resolve(code)))

    process.kill(-runner.pid!, 'SIGINT')
    expect(await exited).toBe(130)
    expect(await gone(Number(readFileSync(pidFile, 'utf8')))).toBe(true)
  })

  it("reads a step's own exit code as a failure, not as a stop at its budget", () => {
    expect(() => mustRun('exit 124', process.execPath, ['-e', 'process.exit(124)'], root)).toThrow(/^exit 124 failed \(/)
  })

  it('still names a step that fails, with its output', () => {
    expect(() => mustRun('fail at once', process.execPath, ['-e', 'console.error("nope"); process.exit(3)'], root)).toThrow(/^fail at once failed \(.*\):\n\nnope$/s)
  })

  it('runs one that finishes within its budget', () => {
    expect(() => mustRun('finish', process.execPath, ['-e', ''], root, undefined, 30_000)).not.toThrow()
  })
})

describe('whether a process is running', () => {
  it('is true while it runs, and false once it has exited', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'])
    await new Promise(resolve => child.once('spawn', resolve))

    expect(isRunning(child.pid!)).toBe(true)
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    expect(isRunning(child.pid!)).toBe(false)
  })
})

describe("an application's ESLint", () => {
  const manifest = (bin: unknown) => {
    mkdirSync(path.join(root, 'node_modules', 'eslint'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', bin }))
  }

  it('is the script its package names for eslint, or its only bin', () => {
    manifest({ eslint: './bin/eslint.js' })
    expect(eslintScriptOf(root)).toBe(path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'))

    manifest('./bin/only.js')
    expect(eslintScriptOf(root)).toBe(path.join(root, 'node_modules', 'eslint', 'bin', 'only.js'))
  })

  it('says so when the application has none, or its package names no script', () => {
    expect(() => eslintScriptOf(root)).toThrow('has no ESLint installed')

    manifest({ other: './x.js' })
    expect(() => eslintScriptOf(root)).toThrow('names no eslint script')
  })
})
