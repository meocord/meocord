import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The runners' own projects, which `verify:runners` checks with each runner installed */
const RUNNER_PROJECTS = 'scripts/runner-consumers/'

/** A tsconfig as tsc names one; the application template's end in `.template` and belong to generated apps */
const TSCONFIG = /^tsconfig(?:\.[\w-]+)?\.json$/

/** The project `bun check` reads when it is given none */
const DEFAULT_PROJECT = 'tsconfig.json'

/**
 * The only step `typecheck` may hold: the checker itself, on one whole project, with nothing after it. A flag, a
 * file argument or a second command could each make a step pass on code that does not type-check.
 */
const CHECK_STEP = /^bun check --no-script(?: -p ([\w./-]+))?$/

const scripts = (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
  .scripts

/** Every tsconfig git tracks, as a path from the repository root: files a build or a spec leaves behind are not ours */
function projects(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => TSCONFIG.test(path.posix.basename(file)) && !file.startsWith(RUNNER_PROJECTS))
}

const steps = scripts.typecheck.split('&&').map(step => step.trim())

describe('bun run typecheck', () => {
  it('is made of whole-project bun check steps and nothing else', () => {
    expect(steps.filter(step => !CHECK_STEP.test(step))).toEqual([])
  })

  it('checks every tsconfig the repository tracks, once each', () => {
    const checked = steps.map(step => CHECK_STEP.exec(step)?.[1] ?? DEFAULT_PROJECT)
    expect(checked.sort()).toEqual(projects().sort())
  })

  it('is what lint ends with', () => {
    expect(scripts.lint.split('&&').at(-1)?.trim()).toBe('bun run typecheck')
  })
})
