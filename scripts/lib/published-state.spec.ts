import { describe, expect, it } from 'vitest'
import { parseVersions, publishedState, ReleaseUnfinished, releaseFound, tagFound } from './published-state.js'

const published = ['4.2.2', '4.2.3']

describe('the published state of the committed version', () => {
  it('leaves a version npm does not list to be packed and published', () => {
    expect(publishedState({ name: 'meocord', version: '4.2.4', versions: published })).toEqual({
      unpublished: true,
      warnings: [],
    })
  })

  it('skips a version npm lists with its tag and GitHub release', () => {
    expect(publishedState({ name: 'meocord', version: '4.2.3', versions: published, tag: true, release: true })).toEqual({
      unpublished: false,
      warnings: [],
    })
  })

  it.each([
    ['its tag', { tag: false, release: true }, 'without its v4.2.3 tag. Create it by hand'],
    ['its GitHub release', { tag: true, release: false }, 'without its GitHub release. Create it by hand'],
    ['both', { tag: false, release: false }, 'without its v4.2.3 tag or its GitHub release. Create them by hand'],
  ])('reports a version npm lists without %s as an unfinished release', (_missing, pieces, message) => {
    const decide = () => publishedState({ name: 'meocord', version: '4.2.3', versions: published, ...pieces })

    expect(decide).toThrow(ReleaseUnfinished)
    expect(decide).toThrow(`meocord@4.2.3 is on npm ${message}`)
  })

  it('skips a listed version whose tag or release could not be checked, saying so', () => {
    expect(publishedState({ name: 'meocord', version: '4.2.3', versions: published, release: true })).toEqual({
      unpublished: false,
      warnings: ['meocord@4.2.3 is on npm, but the v4.2.3 tag could not be checked.'],
    })
  })

  it('packs and offers to publish when npm cannot be read, saying why', () => {
    const state = publishedState({ name: 'meocord', version: '4.2.3', versions: new Error('ETIMEDOUT') })

    expect(state.unpublished).toBe(true)
    expect(state.warnings).toEqual([expect.stringContaining('ETIMEDOUT')])
  })
})

describe("npm's list of versions", () => {
  it('reads the list npm prints', () => {
    expect(parseVersions('[\n  "4.2.2",\n  "4.2.3"\n]')).toEqual(['4.2.2', '4.2.3'])
  })

  it.each([
    ['an error', '{"error":{"code":"E404"}}'],
    ['a version alone', '"4.2.3"'],
  ])('refuses %s, so a broken answer is an npm error rather than a list missing the version', (_shape, json) => {
    expect(() => parseVersions(json)).toThrow('npm printed no list of versions')
  })
})

describe('the tag and release lookups', () => {
  it.each([
    [0, true],
    [2, false],
    [128, undefined],
    [null, undefined],
  ])('reads git ls-remote --exit-code status %s as %s', (status, found) => {
    expect(tagFound(status)).toBe(found)
  })

  it.each([
    [0, '', true],
    [1, 'gh: Not Found (HTTP 404)', false],
    [1, 'gh: Bad credentials (HTTP 401)', undefined],
    [null, '', undefined],
  ])('reads gh api status %s with %j as %s', (status, stderr, found) => {
    expect(releaseFound(status, stderr)).toBe(found)
  })
})
