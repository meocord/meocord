import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { majorChangesetMessage, majorChangesetsOutsidePre } from './major-changeset.js'

let root: string

/** Writes a changeset whose front matter is `frontMatter`. */
function changeset(file: string, frontMatter: string): void {
  writeFileSync(path.join(root, '.changeset', file), `---\n${frontMatter}\n---\n\nA change.\n`)
}

/** Puts the repository in pre-release mode, as `changeset pre enter next` does. */
function enterPre(mode: 'pre' | 'exit' = 'pre'): void {
  const state = { mode, tag: 'next', initialVersions: { meocord: '4.3.0' }, changesets: [] }
  writeFileSync(path.join(root, '.changeset', 'pre.json'), JSON.stringify(state))
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-major-'))
  mkdirSync(path.join(root, '.changeset', 'release-notes', '4.3.0'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'meocord', version: '4.3.0' }))
  writeFileSync(path.join(root, '.changeset', 'README.md'), '# Changesets\n')
  writeFileSync(path.join(root, '.changeset', 'config.json'), '{}')
  writeFileSync(path.join(root, '.changeset', 'release-notes', '4.3.0', 'covered.md'), '- a.md\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a major changeset outside pre-release mode', () => {
  it.each([`'meocord': major`, `"meocord": major`, `meocord: major`])('is refused, written %s', async frontMatter => {
    changeset('drop-old-name.md', frontMatter)
    changeset('fix-a-thing.md', `'meocord': patch`)

    expect(await majorChangesetsOutsidePre(root)).toEqual(['drop-old-name.md'])
  })

  it.each(['pre', 'exit'] as const)('is accepted while pre.json says %s', async mode => {
    enterPre(mode)
    changeset('drop-old-name.md', `'meocord': major`)

    expect(await majorChangesetsOutsidePre(root)).toEqual([])
  })

  it.each([`'meocord': minor`, `'meocord': patch`, `'another-package': major`])(
    'leaves %s alone, which keeps the current major',
    async frontMatter => {
      changeset('a-change.md', frontMatter)

      expect(await majorChangesetsOutsidePre(root)).toEqual([])
    },
  )

  it('names each refused file and says what to do instead', () => {
    const message = majorChangesetMessage(['b.md', 'c.md'])

    expect(message.split('\n')).toEqual([
      expect.stringMatching(/^\.changeset\/b\.md bumps the package by major.*draft pull request.*deprecated alias/),
      expect.stringMatching(/^\.changeset\/c\.md bumps the package by major/),
    ])
  })
})
