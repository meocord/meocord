import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { vi } from 'vitest'
import { readMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'

let project: string

beforeEach(() => {
  project = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-config-load-')))
  vi.spyOn(process, 'cwd').mockReturnValue(project)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(project, { recursive: true, force: true })
})

const load = (source: string) => {
  writeFileSync(path.join(project, 'meocord.config.ts'), source)
  return readMeoCordSourceConfig()
}

describe('loading meocord.config.ts', () => {
  it.each([
    ['a default export', "export default { discordToken: 'abc' }\n"],
    ['module.exports, as a CommonJS config sets it', "module.exports = { discordToken: 'abc' }\n"],
  ])('gives the config from %s', (_, source) => {
    expect(load(source)).toEqual({ config: { discordToken: 'abc' } })
  })

  it('refuses an ES module with no default export, naming what it exports instead', () => {
    expect(load("export const config = { discordToken: 'abc' }\n")).toEqual({
      error: 'it must export an object as its default export, and exports only config',
    })
  })

  it('says where in the config an error it throws came from', () => {
    const result = load("const token = process.env.MEOCORD_LOAD_FOO\n\nif (!token) throw new Error('FOO is required')\nexport default {}\n")

    expect(result).toEqual({ error: expect.stringMatching(/^FOO is required\n {4}at meocord\.config\.ts:3:\d+$/) })
  })
})
