import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'

interface Job {
  name?: string
  needs?: string | string[]
  if?: string
  'timeout-minutes'?: number
  steps?: { name?: string; if?: string; run?: string }[]
}

interface Workflow {
  on: Record<string, { types?: string[] } | null>
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

const reporterOf = (check: string) => Object.keys(jobs).find(id => jobs[id]!.name === check)

// Confined to pushes and manual runs by its own condition, or by a job it needs
const runsOnlyOnPush = (id: string): boolean => {
  const condition = jobs[id]!.if ?? ''
  const confined = condition.includes('github.event_name') && !/'pull_request'|'merge_group'/.test(condition)
  return confined || needsOf(jobs[id]!).some(runsOnlyOnPush)
}

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

  it('runs every job that follows the release only once it succeeded', () => {
    const followers = Object.keys(jobs).filter(id => needsOf(jobs[id]!).includes(RELEASE))

    expect(followers).toEqual(expect.arrayContaining(['pack', 'publish']))
    expect(followers.filter(id => !requiresSuccess(jobs[id]!, RELEASE))).toEqual([])
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
