import { createHash } from 'crypto'

/** A release in changesets' publish plan, as `changeset pack` writes it */
export interface PlannedRelease {
  kind: string
  name: string
  version: string
  tarball?: { path: string; integrity: string }
}

/** `publish-plan.json`: the releases, in groups that publish one after another */
export interface PublishPlan {
  version: number
  plan: PlannedRelease[][]
}

/** What the check compares: the plan Pack wrote, the tarballs it names and the one Build's checks installed */
export interface PackageCheck {
  /** The package's name, from the commit's package.json */
  name: string
  /** The committed version, which `pack` packed because npm didn't have it */
  version: string
  plan: PublishPlan
  /** The bytes of a tarball the plan names, by its path in the plan; `undefined` when it is missing */
  packed: (planPath: string) => Buffer | undefined
  /** The tarball Build packed, which Build's checks and the test runners installed */
  tested: Buffer
  /** Whether npm lists the version now, or why that couldn't be read; asked only of an empty plan */
  listed: () => boolean | Error
}

/** The published tarball isn't the tested one, or the plan is not the one release it should be */
export class PackageMismatch extends Error {
  override name = 'PackageMismatch'
}

/** A tarball's digest as changesets records it in the plan: sha256, in base64 */
export const integrityOf = (bytes: Buffer): string => `sha256-${createHash('sha256').update(bytes).digest('base64')}`

/**
 * Checks, before `publish`, that the plan publishes exactly the committed version and that its tarball is, byte for
 * byte, the one Build's checks installed and the one the plan's integrity names. An empty plan passes only when npm
 * already lists the version, as when npm's listing lagged at Release and caught up by Pack: `publish` then has nothing
 * to do. Returns what it compared, for the log.
 */
export function checkPackage({ name, version, plan, packed, tested, listed }: PackageCheck): string[] {
  const release = `${name}@${version}`
  const publishes = plan.plan.flat().filter(entry => entry.kind === 'publish')

  if (publishes.length === 0) {
    const onNpm = listed()
    if (onNpm === true) return [`The plan publishes nothing: npm already lists ${release}.`]
    const why = onNpm instanceof Error ? `npm's versions could not be read (${onNpm.message})` : 'npm does not list it'
    throw new PackageMismatch(`The plan publishes nothing, but ${release} is unpublished: ${why}.`)
  }
  const planned = publishes.map(entry => `${entry.name}@${entry.version}`)
  const [entry] = publishes
  if (publishes.length > 1 || planned[0] !== release || !entry?.tarball) {
    const publishing = planned.join(', ')
    throw new PackageMismatch(`The plan should publish ${release} alone, with its tarball; it publishes ${publishing}.`)
  }

  const bytes = packed(entry.tarball.path)
  if (!bytes) throw new PackageMismatch(`The plan's tarball ${entry.tarball.path} is not in Pack's artifact.`)
  const values = {
    build: integrityOf(tested),
    pack: integrityOf(bytes),
    plan: entry.tarball.integrity,
  }
  const lines = [
    `${release}:`,
    `  Build's tarball    ${values.build}`,
    `  Pack's tarball     ${values.pack}`,
    `  The plan's record  ${values.plan}`,
  ]
  if (values.pack !== values.plan) {
    throw new PackageMismatch([...lines, "Pack's tarball is not the one its plan records."].join('\n'))
  }
  if (values.build !== values.pack) {
    throw new PackageMismatch(
      [
        ...lines,
        "Pack's tarball differs from the one Build's checks installed. A likely cause: Build and Pack each set " +
          'up the newest LTS Node, and a Node release between them changed how npm writes the tarball.',
      ].join('\n'),
    )
  }
  return lines
}
