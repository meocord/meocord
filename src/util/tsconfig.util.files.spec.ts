import { vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { prepareModifiedTsConfig } from '@src/util/tsconfig.util.js'

// On the real file system, where tsconfig.util.spec.ts mocks it
describe('prepareModifiedTsConfig on disk', () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(path.join(tmpdir(), 'meocord-tsconfig-project-'))
    vi.spyOn(process, 'cwd').mockReturnValue(project)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(project, { recursive: true, force: true })
  })

  it("leaves the project's tsconfig.json byte for byte as it was", () => {
    const original = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  // Imports resolve from src
  "compilerOptions": {
    "baseUrl": "./src", /* as written */
  },
}
`
    const file = path.join(project, 'tsconfig.json')
    writeFileSync(file, original)

    const copy = prepareModifiedTsConfig()

    expect(readFileSync(file, 'utf-8')).toBe(original)
    expect(JSON.parse(readFileSync(copy, 'utf-8')).compilerOptions).toEqual({ baseUrl: path.join(project, 'src') })
  })
})
