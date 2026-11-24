import { isDeepStrictEqual } from 'util'
import path from 'path'
import { ES_MODULE_ONLY_DEPENDENCIES } from '../es-module-only.js'

/** The published manifest, whose ranges decide what a consumer's package manager installs */
export const MANIFEST = 'package.json'

/** The application template, whose pins decide what `meocord create` installs in a new bot */
export const TEMPLATE = 'src/bin/app-template/package.json.template'

/** The lockfile, which decides the version of each package the CommonJS build bundles into `dist/cjs` */
export const LOCKFILE = 'bun.lock'

/** The commits Lint's checkout fetches: a pull request's merge commit and its first parent, the base compared with */
export const CHECKOUT_DEPTH = 2

/** The folder of pending changesets; its README and curated release notes are not changesets */
export const CHANGESET_DIR = '.changeset'
const CHANGESET_README = 'README.md'

/** The published manifest fields that change what a consumer resolves: each maps a dependency to its range */
const MANIFEST_RANGES = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

/** The published manifest field that decides which peers are optional */
const PEER_META = 'peerDependenciesMeta'

/** The template fields a new bot installs */
const TEMPLATE_RANGES = ['dependencies', 'devDependencies'] as const

/** A package.json, or the application template, by the fields this check reads */
export type Manifest = Partial<Record<string, Record<string, unknown>>>

/** The metadata a bun.lock entry records for a package: the dependencies it was resolved with */
interface LockInfo {
  dependencies?: Record<string, string>
}

/**
 * A bun.lock `packages` entry: the resolved `name@version` first, then registry, metadata and integrity. Keys are
 * install paths, `name` at the root and `parent/name` for a copy nested under its parent's `node_modules`.
 */
export interface Lockfile {
  packages: Record<string, [ident: string, ...rest: unknown[]]>
}

/** The three files on one side of the comparison */
export interface Side {
  manifest: Manifest
  template: Manifest
  lock: Lockfile
}

/** The base to compare with: a revision, and whether the checkout has to fetch it first */
export interface Base {
  rev: string
  fetch: boolean
}

/** The packages of an install path: `inversify/@inversifyjs/core` is `inversify`, then `@inversifyjs/core` */
function segmentsOf(key: string): string[] {
  const segments: string[] = []
  const parts = key.split('/')
  for (let index = 0; index < parts.length; index++) {
    segments.push(parts[index]!.startsWith('@') ? `${parts[index]}/${parts[++index]}` : parts[index]!)
  }
  return segments
}

/** The lock key Node loads `name` from when it is required from the package at `from`: nested, then parents, then root */
function resolve(lock: Lockfile, from: string[], name: string): string | undefined {
  for (let depth = from.length; depth >= 0; depth--) {
    const key = [...from.slice(0, depth), name].join('/')
    if (key in lock.packages) return key
  }
  return undefined
}

function infoOf(entry: unknown[]): LockInfo {
  const info = entry.find(part => typeof part === 'object' && part !== null && !Array.isArray(part))
  return (info ?? {}) as LockInfo
}

/**
 * Every package the CommonJS build bundles, as its bun.lock key mapped to its resolved `name@version`: each of
 * {@link ES_MODULE_ONLY_DEPENDENCIES} and, in turn, their `dependencies`, each resolved the way Node resolves it. A
 * copy of the same name installed elsewhere, nested under a package nothing bundles, is left out.
 */
export function bundledEntries(lock: Lockfile): Map<string, string> {
  const bundled = new Map<string, string>()
  const pending = ES_MODULE_ONLY_DEPENDENCIES.flatMap(name => (name in lock.packages ? [name] : []))
  while (pending.length > 0) {
    const key = pending.pop()!
    if (bundled.has(key)) continue
    const entry = lock.packages[key]!
    bundled.set(key, entry[0])
    const from = segmentsOf(key)
    for (const name of Object.keys(infoOf(entry).dependencies ?? {})) {
      const found = resolve(lock, from, name)
      if (found === undefined) throw new Error(`${LOCKFILE} has no entry for ${name}, a dependency of ${key}`)
      pending.push(found)
    }
  }
  return bundled
}

function shown(value: unknown): string {
  return value === undefined ? 'absent' : JSON.stringify(value)
}

/** One line per key whose value differs between the two maps */
function differences(label: string, base: Record<string, unknown>, head: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()
  return keys
    .filter(key => !isDeepStrictEqual(base[key], head[key]))
    .map(key => `${label} ${key}: ${shown(base[key])} to ${shown(head[key])}`)
}

/** The version a lock ident names: `8.3.0` for `inversify@8.3.0` */
function versionOf(ident: string | undefined): string | undefined {
  return ident?.slice(ident.lastIndexOf('@') + 1)
}

/**
 * Each change between two sides that reaches what a consumer gets, one line each: a range in the published
 * manifest's dependency fields, its `peerDependenciesMeta`, a pin in the application template, or the version the
 * lockfile resolves for a package `dist/cjs` bundles. Dev dependencies and the lockfile's other packages are left out:
 * neither is published.
 */
export function consumerChanges(base: Side, head: Side): string[] {
  const lockBase = Object.fromEntries([...bundledEntries(base.lock)].map(([key, ident]) => [key, versionOf(ident)]))
  const lockHead = Object.fromEntries([...bundledEntries(head.lock)].map(([key, ident]) => [key, versionOf(ident)]))
  return [
    ...MANIFEST_RANGES.flatMap(field =>
      differences(`${MANIFEST} ${field}`, base.manifest[field] ?? {}, head.manifest[field] ?? {}),
    ),
    ...differences(`${MANIFEST} ${PEER_META}`, base.manifest[PEER_META] ?? {}, head.manifest[PEER_META] ?? {}),
    ...TEMPLATE_RANGES.flatMap(field =>
      differences(`${TEMPLATE} ${field}`, base.template[field] ?? {}, head.template[field] ?? {}),
    ),
    ...differences(`${LOCKFILE}, bundled into dist/cjs,`, lockBase, lockHead),
  ]
}

/**
 * The changesets among the files a change adds: a Markdown file directly in `.changeset/` other than its README.
 * Curated release notes live in a folder below it and are not changesets.
 */
export function addedChangesets(added: string[]): string[] {
  return added.filter(
    file =>
      path.posix.dirname(file) === CHANGESET_DIR &&
      file.endsWith('.md') &&
      path.posix.basename(file) !== CHANGESET_README,
  )
}

/**
 * The base a GitHub Actions run compares with, or undefined when the event has none. A pull request's checkout is
 * the merge commit, whose first parent is the base it merged onto. The merge queue rebases a pull request onto its
 * group's parent, so a queued merge of several commits has its own commits as parents: the event names the base.
 */
export function baseOf(eventName: string | undefined, event: unknown): Base | undefined {
  if (eventName === 'pull_request') return { rev: 'HEAD^1', fetch: false }
  if (eventName === 'merge_group') {
    const sha = (event as { merge_group?: { base_sha?: unknown } } | undefined)?.merge_group?.base_sha
    if (typeof sha !== 'string' || sha === '') throw new Error('The merge_group event names no base_sha')
    return { rev: sha, fetch: true }
  }
  return undefined
}

/** Why the change can't merge as it is, and what its author does about it */
export function missingChangesetMessage(changes: string[]): string {
  return [
    'This change reaches what a consumer installs, and adds no changeset:',
    ...changes.map(change => `  ${change}`),
    'Run `bun run changeset` to tell the people upgrading what changed. If the change needs no release note, commit',
    'an empty changeset instead: `bun run changeset --empty`.',
  ].join('\n')
}
