import { describe, expect, it } from 'vitest'
import { checkPackage, integrityOf, type PackageCheck, PackageMismatch, type PlannedRelease } from './packed-tarball.js'

const bytes = Buffer.from('the packed bytes')

const publish = (version: string, tarball = bytes): PlannedRelease => ({
  kind: 'publish',
  name: 'meocord',
  version,
  tarball: { path: `packages/meocord-${version}.tgz`, integrity: integrityOf(tarball) },
})

const check = (overrides: Partial<PackageCheck> = {}): PackageCheck => ({
  name: 'meocord',
  version: '4.2.4',
  plan: { version: 1, plan: [[publish('4.2.4')]] },
  packed: planPath => (planPath === 'packages/meocord-4.2.4.tgz' ? bytes : undefined),
  tested: bytes,
  listed: () => false,
  ...overrides,
})

describe('the package check before publishing', () => {
  it('passes the one planned tarball equal to the tested one and to its record, logging all three', () => {
    const lines = checkPackage(check())

    expect(lines).toEqual([
      'meocord@4.2.4:',
      `  Build's tarball    ${integrityOf(bytes)}`,
      `  Pack's tarball     ${integrityOf(bytes)}`,
      `  The plan's record  ${integrityOf(bytes)}`,
    ])
  })

  it("refuses a Pack tarball with one byte changed from the tested one, naming both digests and Node's role", () => {
    const changed = Buffer.from('the packed bytez')
    const decide = () =>
      checkPackage(check({ plan: { version: 1, plan: [[publish('4.2.4', changed)]] }, packed: () => changed }))

    expect(decide).toThrow(PackageMismatch)
    expect(decide).toThrow(`Build's tarball    ${integrityOf(bytes)}`)
    expect(decide).toThrow(`Pack's tarball     ${integrityOf(changed)}`)
    expect(decide).toThrow('a Node release between them changed how npm writes the tarball')
  })

  it('refuses a tarball its plan does not record', () => {
    const plan = { version: 1, plan: [[publish('4.2.4', Buffer.from('other'))]] }

    expect(() => checkPackage(check({ plan }))).toThrow("Pack's tarball is not the one its plan records.")
  })

  it('reads the plan as groups of releases, so a publish in a later group is found', () => {
    const plan = { version: 1, plan: [[{ kind: 'skip', name: 'other', version: '1.0.0' }], [publish('4.2.4')]] }

    expect(checkPackage(check({ plan }))[0]).toBe('meocord@4.2.4:')
  })

  it.each([
    ['two releases', [[publish('4.2.4'), publish('4.2.5')]], 'publishes meocord@4.2.4, meocord@4.2.5'],
    ['another version', [[publish('4.2.5')]], 'publishes meocord@4.2.5'],
  ])('refuses a plan with %s', (_case, plan, published) => {
    expect(() => checkPackage(check({ plan: { version: 1, plan } }))).toThrow(
      `The plan should publish meocord@4.2.4 alone, with its tarball; it ${published}.`,
    )
  })

  it('refuses a planned tarball missing from the artifact', () => {
    expect(() => checkPackage(check({ packed: () => undefined }))).toThrow(
      "The plan's tarball packages/meocord-4.2.4.tgz is not in Pack's artifact.",
    )
  })

  it('passes an empty plan when npm lists the version by now, which leaves publish nothing to do', () => {
    expect(checkPackage(check({ plan: { version: 1, plan: [] }, listed: () => true }))).toEqual([
      'The plan publishes nothing: npm already lists meocord@4.2.4.',
    ])
  })

  it.each([
    ['npm does not list it', () => false, 'npm does not list it'],
    ['npm cannot be read', () => new Error('ETIMEDOUT'), "npm's versions could not be read (ETIMEDOUT)"],
  ])('refuses an empty plan when %s', (_case, listed, why) => {
    expect(() => checkPackage(check({ plan: { version: 1, plan: [] }, listed }))).toThrow(
      `The plan publishes nothing, but meocord@4.2.4 is unpublished: ${why}.`,
    )
  })
})
