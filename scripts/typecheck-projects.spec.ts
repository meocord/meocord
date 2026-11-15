import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

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

const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const { scripts } = manifest

/**
 * The packages a tsconfig's `types` entry can be read from, as TypeScript looks for it: the package the entry names,
 * a subpath belonging to its package, or that package's `@types` one, which spells a scope as `scope__name`
 */
function typingsPackages(entry: string): string[] {
  const segments = entry.split('/')
  const name = entry.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return [name, `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`]
}

/**
 * A path as tsc names files, with forward slashes. Given a Windows path as written, tsc fails its own check of a
 * diagnostic's file name instead of reporting what is wrong with the config.
 */
function tscPath(file: string): string {
  return file.replaceAll('\\', '/')
}

/** The `types` a project is checked with, its own or those a config it extends gives it, as tsc reads them */
function typesOf(project: string): string[] {
  const refuse = (...diagnostics: ts.Diagnostic[]): never => {
    const messages = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    throw new Error(`${project}: ${messages.join('\n')}`)
  }
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tscPath(path.resolve(repoRoot, project)),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: refuse },
  )
  // A config read with an error, a syntax error among them, may give none of the entries the project is checked with
  const problems = parsed ? ts.getConfigFileParsingDiagnostics(parsed) : []
  if (problems.length > 0) refuse(...problems)
  return parsed?.options.types ?? []
}

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

  // Typings nothing declares are whichever version another dependency's own range happens to hoist
  it('names in `types` only packages package.json declares', () => {
    const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
    const named = projects().flatMap(project => typesOf(project).map(entry => ({ project, entry })))
    // A read that finds no entry would leave nothing to check
    expect(named).not.toEqual([])
    const undeclared = named.filter(({ entry }) => !typingsPackages(entry).some(name => declared.has(name)))
    expect(undeclared.map(({ project, entry }) => `${project}: ${entry}`)).toEqual([])
  })

  it.each([
    ['node', ['node', '@types/node']],
    ['vitest/globals', ['vitest', '@types/vitest']],
    ['@scope/name', ['@scope/name', '@types/scope__name']],
    ['@scope/name/globals', ['@scope/name', '@types/scope__name']],
  ])('reads the `types` entry %s from %j', (entry, packages) => {
    expect(typingsPackages(entry)).toEqual(packages)
  })

  it('refuses a config tsc reads with an error, or cannot read', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'typecheck-projects-'))
    try {
      const unclosed = path.join(directory, 'tsconfig.json')
      writeFileSync(unclosed, '{ "compilerOptions": { "types": ["node"] }')
      expect(() => typesOf(unclosed)).toThrow("'}' expected")
      expect(() => typesOf(path.join(directory, 'absent.json'))).toThrow('Cannot read file')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('names a config to tsc with forward slashes, on Windows too', () => {
    expect(tscPath('C:\\Temp\\project\\tsconfig.json')).toBe('C:/Temp/project/tsconfig.json')
    expect(tscPath('/tmp/project/tsconfig.json')).toBe('/tmp/project/tsconfig.json')
  })

  it('is what lint ends with', () => {
    expect(scripts.lint.split('&&').at(-1)?.trim()).toBe('bun run typecheck')
  })
})
