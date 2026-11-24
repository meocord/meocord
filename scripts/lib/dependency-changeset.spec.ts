import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { bundledPackages } from '../es-module-only.js'
import {
  addedChangesets,
  baseOf,
  bundledEntries,
  CHECKOUT_DEPTH,
  consumerChanges,
  LOCKFILE,
  type Lockfile,
  MANIFEST,
  type Side,
  TEMPLATE,
} from './dependency-changeset.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const CLI = path.join(repoRoot, 'scripts', 'check-dependency-changeset.ts')

/** A spawned check, a git init and a few commits each: well inside this, but more than Vitest's default on Windows */
const CLI_TIMEOUT_MS = 30_000

/** A fixture commit's identity, unsigned, with files stored as written on every platform */
const GIT_CONFIG = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false']

/** A bun.lock entry for a registry package, with the dependencies it was resolved with */
function entry(ident: string, dependencies?: Record<string, string>): Lockfile['packages'][string] {
  return [ident, '', dependencies ? { dependencies } : {}, 'sha512-fixture']
}

/**
 * A side shaped like this repository's: chalk and inversify bundled, inversify pulling in two packages, an unbundled
 * runtime dependency, and a dev-only tool with its own nested copy of chalk.
 */
function baseSide(): Side {
  return {
    manifest: {
      dependencies: { chalk: '^6.0.1', commander: '^15.0.0', inversify: '^8.2.3' },
      devDependencies: { '@stryker-mutator/core': '^9.0.0' },
      peerDependencies: { 'discord.js': '^14.25.1', eslint: '^10.0.0' },
      peerDependenciesMeta: { eslint: { optional: true } },
    },
    template: {
      dependencies: { 'discord.js': '^14.28.1', meocord: '^{{version}}' },
      devDependencies: { vitest: '5.1.0' },
    },
    lock: {
      packages: {
        '@inversifyjs/common': entry('@inversifyjs/common@2.0.2'),
        '@inversifyjs/core': entry('@inversifyjs/core@15.1.0', { '@inversifyjs/common': '2.0.2' }),
        '@stryker-mutator/core': entry('@stryker-mutator/core@9.0.0', { chalk: '5.6.2' }),
        '@stryker-mutator/core/chalk': entry('chalk@5.6.2'),
        chalk: entry('chalk@6.0.1'),
        commander: entry('commander@15.0.0'),
        inversify: entry('inversify@8.3.0', { '@inversifyjs/common': '2.0.2', '@inversifyjs/core': '15.1.0' }),
        'is-number': entry('is-number@7.0.0'),
      },
    },
  }
}

/** The consumer changes between the base side and a copy of it that `edit` changes */
function changesAfter(edit: (head: Side) => void): string[] {
  const head = structuredClone(baseSide())
  edit(head)
  return consumerChanges(baseSide(), head)
}

describe('the packages the CommonJS build bundles, read from bun.lock', () => {
  it('follows the dependencies of each bundled package from chalk and inversify, leaving out peers and the rest', () => {
    expect(Object.fromEntries(bundledEntries(baseSide().lock))).toEqual({
      '@inversifyjs/common': '@inversifyjs/common@2.0.2',
      '@inversifyjs/core': '@inversifyjs/core@15.1.0',
      chalk: 'chalk@6.0.1',
      inversify: 'inversify@8.3.0',
    })
  })

  // A nested copy wins over the root's for its parent, and a copy nested two levels down finds its parent's sibling
  it('resolves each dependency as Node does: nested under the package, then under its parents, then at the root', () => {
    const lock: Lockfile = {
      packages: {
        '@inversifyjs/common': entry('@inversifyjs/common@2.0.2'),
        inversify: entry('inversify@9.0.0', { '@inversifyjs/common': '1.0.0', '@inversifyjs/core': '16.0.0' }),
        'inversify/@inversifyjs/common': entry('@inversifyjs/common@1.0.0'),
        'inversify/@inversifyjs/core': entry('@inversifyjs/core@16.0.0', { '@inversifyjs/common': '1.0.0' }),
      },
    }

    expect(Object.fromEntries(bundledEntries(lock))).toEqual({
      inversify: 'inversify@9.0.0',
      'inversify/@inversifyjs/common': '@inversifyjs/common@1.0.0',
      'inversify/@inversifyjs/core': '@inversifyjs/core@16.0.0',
    })
  })

  it('refuses a lockfile missing a dependency of a bundled package', () => {
    const lock = baseSide().lock
    delete lock.packages['@inversifyjs/common']

    expect(() => bundledEntries(lock)).toThrow('bun.lock has no entry for @inversifyjs/common, a dependency of')
  })

  // The check reads both sides' lockfiles, and rollup bundles what node_modules holds: the two must agree
  it('finds in the bun.lock of this repository the packages the build bundles from node_modules', () => {
    const read = 'process.stdout.write(JSON.stringify(Bun.JSONC.parse(require("fs").readFileSync("bun.lock", "utf8"))))'
    const lock = JSON.parse(execFileSync('bun', ['-e', read], { cwd: repoRoot, encoding: 'utf8' })) as Lockfile
    const names = [...bundledEntries(lock).keys()].map(key => /(?:@[^/]+\/)?[^/]+$/.exec(key)![0])

    expect([...new Set(names)].sort()).toEqual(bundledPackages(repoRoot))
  })
})

describe('what reaches a consumer', () => {
  it.each<[string, (head: Side) => void, string[]]>([
    [
      'a changed range',
      head => (head.manifest.dependencies!.commander = '^16.0.0'),
      ['package.json dependencies commander: "^15.0.0" to "^16.0.0"'],
    ],
    [
      'an added peer',
      head => (head.manifest.peerDependencies!.prettier = '^3.0.0'),
      ['package.json peerDependencies prettier: absent to "^3.0.0"'],
    ],
    [
      'a dependency moved to optionalDependencies',
      head => {
        delete head.manifest.dependencies!.commander
        head.manifest.optionalDependencies = { commander: '^15.0.0' }
      },
      [
        'package.json dependencies commander: "^15.0.0" to absent',
        'package.json optionalDependencies commander: absent to "^15.0.0"',
      ],
    ],
    [
      'a peerDependenciesMeta change',
      head => (head.manifest.peerDependenciesMeta!.eslint = { optional: false }),
      ['package.json peerDependenciesMeta eslint: {"optional":true} to {"optional":false}'],
    ],
    [
      'a template pin change',
      head => (head.template.devDependencies!.vitest = '5.1.1'),
      [`${TEMPLATE} devDependencies vitest: "5.1.0" to "5.1.1"`],
    ],
    [
      'a bundled lockfile bump',
      head => (head.lock.packages.inversify![0] = 'inversify@8.2.4'),
      ['bun.lock, bundled into dist/cjs, inversify: "8.3.0" to "8.2.4"'],
    ],
    [
      'a bump of a package a bundled one depends on',
      head => (head.lock.packages['@inversifyjs/common']![0] = '@inversifyjs/common@2.0.3'),
      ['bun.lock, bundled into dist/cjs, @inversifyjs/common: "2.0.2" to "2.0.3"'],
    ],
    [
      'a bundled package gaining a dependency',
      head => (head.lock.packages['@inversifyjs/core']![2] = { dependencies: { 'is-number': '7.0.0' } }),
      ['bun.lock, bundled into dist/cjs, is-number: absent to "7.0.0"'],
    ],
  ])('names %s', (_, edit, changes) => {
    expect(changesAfter(edit)).toEqual(changes)
  })

  it.each<[string, (head: Side) => void]>([
    ['an unbundled lockfile bump', head => (head.lock.packages.commander![0] = 'commander@15.0.1')],
    // Matching chalk by name anywhere in the lockfile would count Stryker's own copy
    [
      'a dev-only nested copy of a bundled package moving',
      head => (head.lock.packages['@stryker-mutator/core/chalk']![0] = 'chalk@5.6.3'),
    ],
    ['a devDependencies range', head => (head.manifest.devDependencies!['@stryker-mutator/core'] = '^9.1.0')],
    ['the scripts of the template', head => (head.template.scripts = { test: 'vitest run --passWithNoTests' })],
    ['an override, which applies only to the root project', head => (head.manifest.overrides = { qs: '6.14.1' })],
  ])('leaves out %s', (_, edit) => {
    expect(changesAfter(edit)).toEqual([])
  })
})

describe('the changesets a change adds', () => {
  it('counts Markdown files directly in .changeset, other than its README', () => {
    expect(
      addedChangesets([
        '.changeset/brave-cats-sing.md',
        '.changeset/README.md',
        '.changeset/config.json',
        '.changeset/release-notes/4.3.3/notes.md',
        'docs/brave-cats-sing.md',
      ]),
    ).toEqual(['.changeset/brave-cats-sing.md'])
  })
})

describe('the base a GitHub Actions run compares with', () => {
  it('is the first parent of the merge commit for a pull request', () => {
    expect(baseOf('pull_request', {})).toEqual({ rev: 'HEAD^1', fetch: false })
  })

  // The queue rebases: a pull request of several commits has its own last commit as the merge's first parent
  it('is the base_sha of the group for a queued merge, fetched first', () => {
    expect(baseOf('merge_group', { merge_group: { base_sha: 'abc123' } })).toEqual({ rev: 'abc123', fetch: true })
    expect(() => baseOf('merge_group', { merge_group: {} })).toThrow('names no base_sha')
  })

  it.each(['push', 'workflow_dispatch', undefined])('is none on %s', event => {
    expect(baseOf(event, {})).toBeUndefined()
  })
})

describe('the check run against a repository', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  /** bun.lock's own text: JSON with a trailing comma after each last member, which JSON.parse refuses */
  function lockText(lock: Lockfile): string {
    return JSON.stringify({ lockfileVersion: 1, ...lock }, null, 2).replace(/([^{[,\s])(\n\s*[}\]])/g, '$1,$2')
  }

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), `dependency-changeset-${prefix}-`))
    roots.push(dir)
    return dir
  }

  function repository() {
    const root = tempDir('repo')
    const git = (...args: string[]) => execFileSync('git', [...GIT_CONFIG, ...args], { cwd: root, encoding: 'utf8' }).trim()
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), text)
    }
    const writeSide = (side: Side) => {
      write(MANIFEST, JSON.stringify(side.manifest, null, 2))
      write(TEMPLATE, JSON.stringify(side.template, null, 2))
      write(LOCKFILE, lockText(side.lock))
    }
    const commit = () => {
      git('add', '-A')
      git('commit', '-q', '--allow-empty', '-m', 'fixture')
      return git('rev-parse', 'HEAD')
    }
    git('init', '-q')
    writeSide(baseSide())
    write('.changeset/pending-note.md', '---\n"meocord": patch\n---\n\nA pending change.\n')
    const base = commit()
    const check = () => {
      const run = spawnSync('bun', [CLI, '--base', base], { cwd: root, encoding: 'utf8', env: { ...process.env } })
      return { status: run.status, output: `${run.stdout}${run.stderr}` }
    }
    return { root, base, git, write, writeSide, commit, check }
  }

  /** The base side with inversify moved in the lockfile alone */
  function bumped(): Side {
    const side = baseSide()
    side.lock.packages.inversify![0] = 'inversify@8.2.4'
    return side
  }

  const CHANGESET = '---\n"meocord": patch\n---\n\nThe container resolves activations parent first.\n'
  const EMPTY_CHANGESET = '---\n---\n'

  it(
    'fails a bundled bump with no changeset, naming the package and the commands',
    () => {
      const repo = repository()
      repo.writeSide(bumped())
      repo.commit()

      const { status, output } = repo.check()
      expect(status).toBe(1)
      expect(output).toContain('bun.lock, bundled into dist/cjs, inversify: "8.3.0" to "8.2.4"')
      expect(output).toContain('`bun run changeset`')
      expect(output).toContain('`bun run changeset --empty`')
    },
    CLI_TIMEOUT_MS,
  )

  it.each([
    ['a changeset', CHANGESET],
    ['an empty changeset', EMPTY_CHANGESET],
  ])(
    'passes a bundled bump with %s added',
    (_, text) => {
      const repo = repository()
      repo.writeSide(bumped())
      repo.write('.changeset/brave-cats-sing.md', text)
      repo.commit()

      const { status, output } = repo.check()
      expect(output).toContain('.changeset/brave-cats-sing.md covers what a consumer installs')
      expect(status).toBe(0)
    },
    CLI_TIMEOUT_MS,
  )

  it.each<[string, (repo: ReturnType<typeof repository>) => void]>([
    [
      'a changeset added and deleted again',
      repo => {
        repo.write('.changeset/brave-cats-sing.md', CHANGESET)
        repo.commit()
        repo.git('rm', '-q', '.changeset/brave-cats-sing.md')
      },
    ],
    ['only .changeset/README.md added', repo => repo.write('.changeset/README.md', '# Changesets\n')],
    ['only curated release notes added', repo => repo.write('.changeset/release-notes/4.3.3/notes.md', '# 4.3.3\n')],
    ['an edit to a pending changeset', repo => repo.write('.changeset/pending-note.md', CHANGESET)],
    ['a pending changeset renamed', repo => repo.git('mv', '.changeset/pending-note.md', '.changeset/renamed.md')],
  ])(
    'fails a bundled bump with %s',
    (_, change) => {
      const repo = repository()
      repo.writeSide(bumped())
      change(repo)
      repo.commit()

      const { status, output } = repo.check()
      expect(output).toContain('adds no changeset')
      expect(status).toBe(1)
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'passes an unbundled lockfile bump with no changeset',
    () => {
      const repo = repository()
      const side = baseSide()
      side.lock.packages.commander![0] = 'commander@15.0.1'
      repo.writeSide(side)
      repo.commit()

      const { status, output } = repo.check()
      expect(output).toContain('Nothing a consumer installs changed.')
      expect(status).toBe(0)
    },
    CLI_TIMEOUT_MS,
  )

  // The base moved on after the branch left it: a bump and its changeset landed there
  it(
    'compares a branch behind --base from where it left it, so later changes on the base do not count',
    () => {
      const repo = repository()
      repo.git('branch', 'behind')
      repo.writeSide(bumped())
      repo.write('.changeset/brave-cats-sing.md', CHANGESET)
      const moved = repo.commit()
      repo.git('checkout', '-q', 'behind')
      repo.write('CONTRIBUTING.md', 'Work on the branch.\n')
      repo.commit()

      const run = spawnSync('bun', [CLI, '--base', moved], { cwd: repo.root, encoding: 'utf8' })
      expect(`${run.stdout}${run.stderr}`).toContain('Nothing a consumer installs changed.')
      expect(run.status).toBe(0)
    },
    CLI_TIMEOUT_MS,
  )

  describe('as GitHub Actions runs it', () => {
    /** A mirror of the fixture repository that, as GitHub does, serves any commit asked for by its SHA */
    function originOf(root: string): string {
      const origin = tempDir('origin')
      execFileSync('git', ['clone', '-q', '--mirror', root, origin])
      execFileSync('git', ['config', 'uploadpack.allowAnySHA1InWant', 'true'], { cwd: origin })
      return origin
    }

    /** A checkout made as actions/checkout makes one: only `sha` and its ancestors up to `depth`, detached */
    function checkout(root: string, sha: string, depth: number): string {
      const dir = tempDir('checkout')
      const git = (...args: string[]) => execFileSync('git', [...GIT_CONFIG, ...args], { cwd: dir, encoding: 'utf8' })
      git('init', '-q')
      git('remote', 'add', 'origin', pathToFileURL(originOf(root)).href)
      git('fetch', '-q', '--no-tags', `--depth=${depth}`, 'origin', sha)
      git('checkout', '-q', '--detach', 'FETCH_HEAD')
      return dir
    }

    /** Runs the check as the Lint step does: no `--base`, the event's name and payload in the environment */
    function runAs(cwd: string, eventName: string, payload: unknown) {
      const eventPath = path.join(tempDir('event'), 'event.json')
      writeFileSync(eventPath, JSON.stringify(payload))
      const env = { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath }
      const run = spawnSync('bun', [CLI], { cwd, encoding: 'utf8', env })
      return { status: run.status, output: `${run.stdout}${run.stderr}` }
    }

    /** A queued merge of a pull request's two commits, the bump in the first, so its first parent isn't the base */
    function queuedMerge(changeset?: string) {
      const repo = repository()
      repo.writeSide(bumped())
      repo.commit()
      repo.write('CONTRIBUTING.md', 'A second commit.\n')
      if (changeset !== undefined) repo.write('.changeset/brave-cats-sing.md', changeset)
      return { base: repo.base, dir: checkout(repo.root, repo.commit(), CHECKOUT_DEPTH) }
    }

    /** A pull request's merge commit onto the base, the bump on the pull request's branch */
    function pullRequestMerge(depth: number): string {
      const repo = repository()
      repo.git('checkout', '-q', '-b', 'feature')
      repo.writeSide(bumped())
      repo.commit()
      repo.git('checkout', '-q', '--detach', repo.base)
      repo.git('merge', '-q', '--no-ff', '-m', 'fixture merge', 'feature')
      const merge = repo.git('rev-parse', 'HEAD')
      repo.git('update-ref', 'refs/pull/1/merge', merge)
      return checkout(repo.root, merge, depth)
    }

    it(
      'fetches the base_sha of a queued merge, which its checkout lacks, and fails a bump with no changeset',
      () => {
        const { base, dir } = queuedMerge()
        expect(spawnSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: dir }).status).not.toBe(0)

        const { status, output } = runAs(dir, 'merge_group', { merge_group: { base_sha: base } })
        expect(output).toContain('bun.lock, bundled into dist/cjs, inversify: "8.3.0" to "8.2.4"')
        expect(status).toBe(1)
      },
      CLI_TIMEOUT_MS,
    )

    it(
      'passes the same queued merge with a changeset added',
      () => {
        const { base, dir } = queuedMerge(CHANGESET)

        const { status, output } = runAs(dir, 'merge_group', { merge_group: { base_sha: base } })
        expect(output).toContain('.changeset/brave-cats-sing.md covers what a consumer installs')
        expect(status).toBe(0)
      },
      CLI_TIMEOUT_MS,
    )

    // Its first parent is the pull request's own first commit, which already has the bump
    it(
      'would miss the bump comparing a queued merge with its first parent',
      () => {
        const { dir } = queuedMerge()

        const run = spawnSync('bun', [CLI, '--base', 'HEAD^1'], { cwd: dir, encoding: 'utf8' })
        expect(run.stdout).toContain('Nothing a consumer installs changed.')
        expect(run.status).toBe(0)
      },
      CLI_TIMEOUT_MS,
    )

    it(
      'refuses a queued merge whose event names no base_sha',
      () => {
        const { status, output } = runAs(repository().root, 'merge_group', { merge_group: {} })
        expect(output).toContain('The merge_group event names no base_sha')
        expect(status).not.toBe(0)
      },
      CLI_TIMEOUT_MS,
    )

    it(
      "compares a pull request's merge commit with its first parent, in a checkout of two commits",
      () => {
        const { status, output } = runAs(pullRequestMerge(CHECKOUT_DEPTH), 'pull_request', {})
        expect(output).toContain('bun.lock, bundled into dist/cjs, inversify: "8.3.0" to "8.2.4"')
        expect(status).toBe(1)
      },
      CLI_TIMEOUT_MS,
    )

    it(
      'names the missing base, not a missing file, in a checkout of one commit',
      () => {
        const { status, output } = runAs(pullRequestMerge(1), 'pull_request', {})
        expect(output).toContain("HEAD^1 is not in this checkout. Fetch it first; in CI, Lint's checkout fetches two")
        expect(status).toBe(2)
      },
      CLI_TIMEOUT_MS,
    )
  })

  it(
    'skips a push, which has no base, and refuses to guess one outside GitHub Actions',
    () => {
      const repo = repository()
      const run = (env: NodeJS.ProcessEnv) =>
        spawnSync('bun', [CLI], { cwd: repo.root, encoding: 'utf8', env })
      const { GITHUB_EVENT_NAME: _, GITHUB_EVENT_PATH: __, ...local } = process.env

      expect(run({ ...local, GITHUB_EVENT_NAME: 'push' })).toMatchObject({ status: 0, stdout: expect.stringContaining('Skipped on push') })
      expect(run(local)).toMatchObject({ status: 2, stderr: expect.stringContaining('--base <rev>') })
    },
    CLI_TIMEOUT_MS,
  )
})
