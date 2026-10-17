import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'

interface Job {
  name?: string
  needs?: string | string[]
  if?: string
}

/** The checks branch protection requires on main, by the name of the job reporting each, as the settings list them */
const REQUIRED_CHECKS = ['Lint', 'Test', 'Build', 'Coverage', 'Windows', 'Redis', 'Test runners']

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

describe('the Release workflow', () => {
  it('has a job reporting each required check', () => {
    expect(REQUIRED_CHECKS.filter(check => reporterOf(check) === undefined)).toEqual([])
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
