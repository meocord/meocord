import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'

interface Job {
  name?: string
  needs?: string | string[]
  if?: string
  'timeout-minutes'?: number
  steps?: { if?: string }[]
}

/** The checks branch protection requires on main, by the name of the job reporting each, as the settings list them */
const REQUIRED_CHECKS = ['Lint', 'Test', 'Build', 'Coverage', 'Windows', 'Redis', 'Test runners']

/** Pull request jobs that block no merge by design: real Discord, so its outages can't, and its fork notice */
const ADVISORY_JOBS = ['e2e', 'e2e-fork']

/** The jobs that start a release: they run only once every required check has passed on the commit they release */
const RELEASE_GATES = ['release-checks', 'release']

/** The job that versions, which `pack` and `publish` follow */
const RELEASE = 'release'

const workflowPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'release.yml')
const { jobs } = parse(readFileSync(workflowPath, 'utf8')) as { jobs: Record<string, Job> }

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

  it('limits how long every job runs', () => {
    expect(Object.keys(jobs).filter(id => jobs[id]!['timeout-minutes'] === undefined)).toEqual([])
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
