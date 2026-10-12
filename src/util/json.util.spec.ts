import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseJsonc, readJsonFile, stripJsonc } from '@src/util/json.util.js'

describe('parseJsonc', () => {
  it('reads line and block comments', () => {
    const input = `{
  // the target
  "target": "ESNext", /* inline */
  /* a block
     over lines */
  "strict": true
}`
    expect(parseJsonc(input)).toEqual({ target: 'ESNext', strict: true })
  })

  it('reads trailing commas in objects and arrays, even before a comment', () => {
    expect(parseJsonc(`{ "a": [1, 2, ], "b": { "c": 1, // last\n }, }`)).toEqual({ a: [1, 2], b: { c: 1 } })
  })

  it('keeps URLs, globs and escaped quotes inside strings', () => {
    const input = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  "include": ["src/**/*.ts", "a,]"],
  "note": "say \\"hi\\" // not a comment"
}`
    expect(parseJsonc(input)).toEqual({
      $schema: 'https://json.schemastore.org/tsconfig',
      include: ['src/**/*.ts', 'a,]'],
      note: 'say "hi" // not a comment',
    })
  })

  it('leaves strict JSON as it is', () => {
    const input = `{"key":"value","num":42}`
    expect(stripJsonc(input)).toBe(input)
  })

  // As a Windows editor saves a file, and as tsc reads it
  it('reads text that starts with a byte order mark', () => {
    expect(parseJsonc('\uFEFF{ "strict": true, // on\n }')).toEqual({ strict: true })
  })

  it('still rejects text that is not JSON once comments are gone', () => {
    expect(() => parseJsonc('{ key: 1 }')).toThrow()
  })
})

describe('readJsonFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meocord-json-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a file saved with a byte order mark, as Node reads a package.json', () => {
    const file = path.join(dir, 'package.json')
    writeFileSync(file, '\uFEFF{"name":"x","dependencies":{"meocord":"*"}}')

    expect(readJsonFile(file)).toEqual({ name: 'x', dependencies: { meocord: '*' } })
  })
})
