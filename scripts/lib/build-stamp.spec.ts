import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { assertFreshBuild, STALE_BUILD, writeBuildStamp } from './build-stamp.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-stamp-'))
  mkdirSync(path.join(root, 'src', 'core'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'core', 'app.ts'), 'export const app = 1\n')
  writeFileSync(path.join(root, 'package.json'), '{ "name": "meocord" }\n')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the build stamp', () => {
  it('accepts dist built from the source as it is', () => {
    writeBuildStamp(root)

    expect(() => assertFreshBuild(root)).not.toThrow()
  })

  it('refuses dist with no stamp', () => {
    expect(() => assertFreshBuild(root)).toThrow(STALE_BUILD)
  })

  it('refuses dist once a source file changes, is added or is removed', () => {
    writeBuildStamp(root)
    writeFileSync(path.join(root, 'src', 'core', 'app.ts'), 'export const app = 2\n')
    expect(() => assertFreshBuild(root)).toThrow(STALE_BUILD)

    writeBuildStamp(root)
    writeFileSync(path.join(root, 'src', 'core', 'theme.ts'), 'export const theme = {}\n')
    expect(() => assertFreshBuild(root)).toThrow(STALE_BUILD)

    writeBuildStamp(root)
    rmSync(path.join(root, 'src', 'core', 'theme.ts'))
    expect(() => assertFreshBuild(root)).toThrow(STALE_BUILD)
  })

  it('refuses dist once the package manifest changes', () => {
    writeBuildStamp(root)
    writeFileSync(path.join(root, 'package.json'), '{ "name": "meocord", "version": "2" }\n')

    expect(() => assertFreshBuild(root)).toThrow(STALE_BUILD)
  })

  it('ignores specs and type tests, which the build leaves out', () => {
    writeBuildStamp(root)
    writeFileSync(path.join(root, 'src', 'core', 'app.spec.ts'), 'it("runs", () => {})\n')
    writeFileSync(path.join(root, 'src', 'core', 'app.test-d.ts'), 'export {}\n')

    expect(() => assertFreshBuild(root)).not.toThrow()
  })

  it('says what to run', () => {
    expect(STALE_BUILD).toBe('dist is older than the source: run `bun run build` first')
  })
})
