import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { isBuiltin } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import { parse } from 'yaml'

interface Job {
  name?: string
  needs?: string | string[]
  if?: string
  'timeout-minutes'?: number
  outputs?: Record<string, string>
  permissions?: Record<string, string>
  environment?: string
  steps?: { id?: string; name?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> }[]
}

interface Workflow {
  on: Record<string, { types?: string[] } | null>
  concurrency?: unknown
  jobs: Record<string, Job>
}

/** The checks branch protection requires on main that this workflow reports, by job name; AGENTS.md's is the other */
const REQUIRED_CHECKS = ['Lint', 'Test', 'Build', 'Coverage', 'Windows', 'Redis', 'Test runners']

/** Pull request jobs that block no merge by design: real Discord, so its outages can't, and its fork notice */
const ADVISORY_JOBS = ['e2e', 'e2e-fork']

/** The jobs that start a release: they run only once every required check has passed on the commit they release */
const RELEASE_GATES = ['release-checks', 'release']

/** Docs sync's step that polls the registry until it serves a published version */
const WAIT_FOR_NPM = 'Wait for npm to serve the version'

/** The job that versions, which `pack` and `publish` follow */
const RELEASE = 'release'

/** The jobs that release the committed version, which run only when npm doesn't have it yet */
const PUBLISHERS = ['pack', 'publish']

/** The condition, among those every publisher requires, that npm doesn't have the committed version */
const UNPUBLISHED = `needs.${RELEASE}.outputs.unpublished == 'true'`

/** The job that packs the tarball every check installs, and its artifact */
const BUILD = 'build'
const PACKAGE_ARTIFACT = 'package'

/** The read-only job that holds a release to the tarball Build packed, and the script it runs */
const CHECK_PACKAGE = 'check-package'
const CHECK_SCRIPT = 'scripts/check-packed-tarball.ts'

/** A step that installs dependencies or builds, which the read-only check must not run */
const INSTALLS = /\b(?:bun|npm|pnpm|yarn)\s+(?:install|ci|add|run build)\b/

/** The checks a push runs once each, against the tarball Build packed */
const ONCE_PER_PUSH = [
  'Check the public API against the latest release',
  'Verify generated applications',
  'Run the slow CLI scenarios',
]

/** The required check whose job refuses a major changeset, and the command it runs */
const LINT_CHECK = 'Lint'
const MAJOR_CHECK = 'bun run major:check'

/** The jobs that run code from outside the lockfile, which keep no token in their checkout */
const OUTSIDE_LOCKFILE = ['build', 'slow-scenarios', 'release-checks']

/** The pull request events a label change sends */
const LABEL_EVENTS = ['labeled', 'unlabeled']

/** The pull request events that can change the AGENTS.md guard's verdict: a new commit or the approval label */
const GUARD_EVENTS = ['opened', 'synchronize', 'reopened', ...LABEL_EVENTS]

/** The label that approves a change to AGENTS.md */
const APPROVAL_LABEL = 'agents-md-approved'

/** The AGENTS.md workflow's step that checks the approval label */
const GUARD_STEP = 'Guard AGENTS.md'

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
const readWorkflow = (file: string) => parse(readFileSync(path.join(workflowsDir, file), 'utf8')) as Workflow
const release = readWorkflow('release.yml')
const { jobs } = release

const needsOf = (job: Job) => [job.needs ?? []].flat()

// A need's result named in the job's condition, as the workflow does to keep a skipped job upstream from skipping it
const requiresSuccess = (job: Job, need: string) =>
  needsOf(job).includes(need) && (job.if ?? '').replace(/\s+/g, ' ').includes(`needs.${need}.result == 'success'`)

// A job's condition as the conditions it requires all of; `undefined` when an `||` makes any of them optional
const conjunctsOf = (job: Job) => {
  const condition = (job.if ?? '').replace(/\s+/g, ' ')
  return condition.includes('||') ? undefined : condition.split('&&').map(part => part.trim())
}

// Every job a job waits for, directly or through another
const needsClosure = (id: string): string[] =>
  needsOf(jobs[id]!).flatMap(need => [need, ...needsClosure(need)])

// A script's imports, and the imports of the scripts' own modules it imports: static, type-only, re-exported and
// dynamic, as TypeScript reads them
function importsOf(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []
  seen.add(file)
  const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
  return importedFiles.map(({ fileName }) => fileName).flatMap(specifier =>
    specifier.startsWith('.')
      ? importsOf(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')), seen)
      : [specifier],
  )
}

const reporterOf = (check: string) => Object.keys(jobs).find(id => jobs[id]!.name === check)

// Confined to pushes and manual runs by its own condition, or by a job it needs
const runsOnlyOnPush = (id: string): boolean => {
  const condition = jobs[id]!.if ?? ''
  const confined = condition.includes('github.event_name') && !/'pull_request'|'merge_group'/.test(condition)
  return confined || needsOf(jobs[id]!).some(runsOnlyOnPush)
}

/** The event a push run evaluates its conditions for */
const PUSH = 'push'

/** A condition's tokens: the ${{ }} wrapper, operators, parentheses, single-quoted strings and context paths */
const TOKEN = /\s*(\$\{\{|\}\}|&&|\|\||==|!=|!|\(|\)|'[^']*'|[A-Za-z_][\w.*-]*)/y

/** Values a run only learns as it goes: outputs, step outcomes and repository variables */
const RUNTIME_VALUE = /\b(?:needs\.[\w-]+\.outputs\.|steps\.[\w-]+\.(?:outputs\.|outcome\b)|vars\.)/

/**
 * Whether a job or step condition holds on a push: a need's result is `success` when that job runs on a push and
 * `skipped` when it doesn't, a value only the run learns is taken as true, so the step may run, and a pull request's
 * fields are absent. Any other shape throws, so a new kind of condition extends this rather than passing unread.
 */
function holdsOnPush(condition: string): boolean {
  const tokens: string[] = []
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < condition.trimEnd().length) {
    const from = TOKEN.lastIndex
    const match = TOKEN.exec(condition)
    if (!match) throw new Error(`Unreadable condition from ${JSON.stringify(condition.slice(from))}: ${condition}`)
    if (match[1] !== '${{' && match[1] !== '}}') tokens.push(match[1]!)
  }
  let at = 0
  const take = (expected?: string) => {
    const token = tokens[at++]
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`Expected ${expected ?? 'more'} in: ${condition}`)
    }
    return token
  }
  const or = (): boolean => {
    let value = and()
    while (tokens[at] === '||') take() && (value = and() || value)
    return value
  }
  const and = (): boolean => {
    let value = unary()
    while (tokens[at] === '&&') take() && (value = unary() && value)
    return value
  }
  const unary = (): boolean => (tokens[at] === '!' ? (take(), !unary()) : primary())
  const primary = (): boolean => {
    if (tokens[at] === '(') {
      take()
      const value = or()
      take(')')
      return value
    }
    const left = take()
    if (tokens[at] === '(') {
      take()
      take(')')
      const status: Record<string, boolean> = { always: true, success: true, cancelled: false, failure: false }
      if (!(left in status)) throw new Error(`Unsupported function ${left}() in: ${condition}`)
      return status[left]!
    }
    const op = take()
    const right = take()
    if (op !== '==' && op !== '!=') throw new Error(`Unsupported operator ${op} in: ${condition}`)
    const literal = right.startsWith("'") ? right.slice(1, -1) : undefined
    const equal = (value: string | null) => (value === literal) === (op === '==')
    if (left === 'github.event_name' && literal !== undefined) return equal(PUSH)
    const need = /^needs\.([\w-]+)\.result$/.exec(left)?.[1]
    if (need && literal !== undefined) return equal(runsOnPush(need) ? 'success' : 'skipped')
    if (/^github\.event\.pull_request\./.test(left)) return equal(null)
    if (RUNTIME_VALUE.test(left)) return true
    throw new Error(`Unsupported comparison ${left} ${op} ${right} in: ${condition}`)
  }
  const value = or()
  if (at !== tokens.length) throw new Error(`Unread ${tokens.slice(at).join(' ')} in: ${condition}`)
  return value
}

/** Whether GitHub's implicit success() applies, which skips a job when a job it needs was skipped */
const STATUS_FUNCTION = /\b(?:always|success|cancelled|failure)\(\)/

// Runs on a push: its condition holds, and, under the implicit success(), every job it needs runs too
function runsOnPush(id: string): boolean {
  const condition = jobs[id]!.if ?? ''
  if (condition && !holdsOnPush(condition)) return false
  return STATUS_FUNCTION.test(condition) || needsOf(jobs[id]!).every(runsOnPush)
}

// Whether a step's running on a push depends only on what the workflow says, not on a value its run learns
const certainOnPush = (id: string, step: { if?: string }): boolean =>
  [step.if, jobs[id]!.if, ...needsClosure(id).map(need => jobs[need]!.if)].every(
    condition => condition === undefined || !RUNTIME_VALUE.test(condition),
  )

// A gate that needs the job and fails a step when it doesn't succeed, so the check the gate reports fails with it
const reportsOn = (gate: Job, id: string) =>
  needsOf(gate).includes(id) &&
  (gate.steps ?? []).some(step => step.if?.replace(/\s+/g, ' ').includes(`needs.${id}.result != 'success'`))

describe('the Release workflow', () => {
  it('has a job reporting each required check', () => {
    expect(REQUIRED_CHECKS.filter(check => reporterOf(check) === undefined)).toEqual([])
  })

  it('blocks a merge on every job a pull request or a queued merge runs, other than the advisory ones', () => {
    const reporters = REQUIRED_CHECKS.map(check => reporterOf(check)!)
    const unchecked = Object.keys(jobs).filter(
      id =>
        !runsOnlyOnPush(id) &&
        !ADVISORY_JOBS.includes(id) &&
        !reporters.includes(id) &&
        !reporters.some(reporter => reportsOn(jobs[reporter]!, id)),
    )

    expect(unchecked).toEqual([])
  })

  it('bounds every registry request in the wait for npm, connecting included', () => {
    const wait = jobs['docs-sync']!.steps!.find(step => step.name === WAIT_FOR_NPM)!.run!
    const npm = wait.match(/^.*\bnpm view\b.*$/gm) ?? []
    const curl = wait.match(/^.*\bcurl\b.*$/gm) ?? []

    expect([npm.length, curl.length]).toEqual([1, 1])
    expect(npm.filter(line => !line.includes('timeout "$REQUEST_SECONDS" npm view'))).toEqual([])
    expect(curl.filter(line => !line.includes('--max-time "$REQUEST_SECONDS"'))).toEqual([])
  })

  it.each(RELEASE_GATES)('runs %s only once every required check has passed', gate => {
    const reporters = REQUIRED_CHECKS.map(check => reporterOf(check)!)

    expect(reporters.filter(id => !requiresSuccess(jobs[gate]!, id))).toEqual([])
  })

  it('packs and publishes only a version npm does not have yet', () => {
    const published = jobs[RELEASE]!.steps!.find(step => step.id === 'published')

    expect(published).toMatchObject({
      if: "steps.changesets.outputs.has-changesets == 'false'",
      run: 'bun scripts/published-state.ts',
    })
    expect(jobs[RELEASE]!.outputs?.unpublished).toBe('${{ steps.published.outputs.unpublished }}')
    expect(PUBLISHERS.filter(id => !conjunctsOf(jobs[id]!)?.includes(UNPUBLISHED))).toEqual([])
  })

  // Run by run, so a run never sees an earlier one's publish halfway, its version on npm before its tag is pushed
  it('runs one push or manual run of a ref at a time, cancelling only pull requests', () => {
    expect(release.concurrency).toEqual({
      group: 'ci-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    })
  })

  it('gives every job that installs the packed package the build that packed it to wait for', () => {
    const downloaders = Object.keys(jobs).filter(id =>
      (jobs[id]!.steps ?? []).some(
        step => step.uses?.startsWith('actions/download-artifact@') && step.with?.name === PACKAGE_ARTIFACT,
      ),
    )

    expect(downloaders).toEqual(expect.arrayContaining(['runners', 'release-checks', CHECK_PACKAGE]))
    expect(downloaders.filter(id => !needsClosure(id).includes(BUILD))).toEqual([])
  })

  it('checks the package before publishing, in a read-only job that installs and builds nothing', () => {
    const check = jobs[CHECK_PACKAGE]!

    expect(check.permissions).toEqual({ contents: 'read' })
    expect(check.environment).toBeUndefined()
    expect((check.steps ?? []).filter(step => INSTALLS.test(step.run ?? '')).map(step => step.name)).toEqual([])
    expect(check.steps!.find(step => step.uses?.startsWith('actions/checkout@'))?.with).toEqual({
      'persist-credentials': false,
    })
    expect(check.steps!.some(step => step.run?.includes(`bun --no-install ${CHECK_SCRIPT}`))).toBe(true)
    expect(conjunctsOf(jobs.publish!)).toContain(`needs.${CHECK_PACKAGE}.result == 'success'`)
  })

  it("compares the tarballs with Node's own modules only, as the check installs nothing", () => {
    const imports = importsOf(path.resolve(workflowsDir, '..', '..', CHECK_SCRIPT))

    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter(specifier => !isBuiltin(specifier))).toEqual([])
  })

  it('reads every job and step condition for a push', () => {
    const conditions = Object.values(jobs).flatMap(job => [job.if, ...(job.steps ?? []).map(step => step.if)])

    expect(() => conditions.filter(condition => condition !== undefined).forEach(holdsOnPush)).not.toThrow()
  })

  it.each(ONCE_PER_PUSH)('runs "%s" once on a push, whatever the run learns', check => {
    const running = Object.keys(jobs).flatMap(id =>
      runsOnPush(id)
        ? (jobs[id]!.steps ?? [])
            .filter(step => step.name === check && (step.if === undefined || holdsOnPush(step.if)))
            .map(step => ({ id, certain: certainOnPush(id, step) }))
        : [],
    )

    expect(running).toEqual([{ id: expect.any(String), certain: true }])
  })

  it('keeps no token in the checkout of a job that runs code from outside the lockfile', () => {
    const checkoutOf = (id: string) => jobs[id]!.steps!.find(step => step.uses?.startsWith('actions/checkout@'))

    expect(OUTSIDE_LOCKFILE.filter(id => checkoutOf(id)?.with?.['persist-credentials'] !== false)).toEqual([])
  })

  it('runs every job that follows the release only once it succeeded', () => {
    const followers = Object.keys(jobs).filter(id => needsOf(jobs[id]!).includes(RELEASE))

    expect(followers).toEqual(expect.arrayContaining(['pack', 'publish']))
    expect(followers.filter(id => !requiresSuccess(jobs[id]!, RELEASE))).toEqual([])
  })

  // Outside pre-release mode a major changeset would turn the next release into a major
  it('refuses a major changeset in the Lint check, which every merge needs', () => {
    const lint = jobs[reporterOf(LINT_CHECK)!]!

    expect(lint.if).toBeUndefined()
    expect((lint.steps ?? []).filter(step => step.if === undefined).map(step => step.run)).toContain(MAJOR_CHECK)
  })
})

describe('the AGENTS.md guard', () => {
  it('lives in its own workflow alone, so a label change re-runs none of the code checks', () => {
    const triggers = release.on.pull_request?.types ?? []

    expect(triggers.filter(type => LABEL_EVENTS.includes(type))).toEqual([])
    expect(Object.keys(jobs).filter(id => JSON.stringify(jobs[id]).includes(APPROVAL_LABEL))).toEqual([])
  })

  it('runs on every pull request event that can change its verdict, and in the merge queue', () => {
    const guard = readWorkflow('agents-md.yml')

    expect(guard.on.pull_request?.types).toEqual(expect.arrayContaining(GUARD_EVENTS))
    expect(guard.on).toHaveProperty('merge_group')
    expect(Object.values(guard.jobs).map(job => job.name)).toEqual(['AGENTS.md'])
  })

  // An event's labels are those it was sent with, and a re-run replays them, label added since or not
  it('reads the approval label from the pull request when it runs, never from the event', () => {
    const guard = readWorkflow('agents-md.yml')
    const step = Object.values(guard.jobs).flatMap(job => job.steps ?? []).find(step => step.name === GUARD_STEP)!

    expect(JSON.stringify(guard)).not.toContain('pull_request.labels')
    expect(step.run!.match(/^\s*labels=.*$/gm)).toEqual([expect.stringContaining('gh pr view')])
  })
})

describe('every workflow', () => {
  it('limits how long each of its jobs runs', () => {
    const unlimited = readdirSync(workflowsDir)
      .filter(file => file.endsWith('.yml'))
      .flatMap(file =>
        Object.entries(readWorkflow(file).jobs)
          .filter(([, job]) => job['timeout-minutes'] === undefined)
          .map(([id]) => `${file}: ${id}`),
      )

    expect(unlimited).toEqual([])
  })
})
