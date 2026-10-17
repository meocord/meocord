import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CHILD_PROCESS_CASE_TIMEOUT_MS, CHILD_PROCESS_TIMEOUT_MS } from '@src/spec-timeouts.js'

/**
 * Params named like an Object.prototype member, written where Object.prototype is frozen, as SES's lockdown() or a
 * hand-run Object.freeze leaves it. Freezing can't be undone, so it runs in its own process, under Bun.
 */
const bun = process.versions.bun ? process.execPath : 'bun'
const valueUtil = JSON.stringify(path.resolve(import.meta.dirname, 'value.util.ts'))
const dir = mkdtempSync(path.join(tmpdir(), 'meocord-frozen-'))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

it('sets and shadows a key Object.prototype has as an own one, where Object.prototype is frozen', () => {
  const script = path.join(dir, 'frozen.ts')
  writeFileSync(
    script,
    `const { setOwn, shadowInherited } = await import(${valueUtil})
Object.freeze(Object.prototype)
const params: Record<string, unknown> = {}
setOwn(params, 'toString', 'a')
setOwn(params, 'constructor', 'b')
setOwn(params, '__proto__', 'c')
setOwn(params, 'name', 'd')
shadowInherited(params, ['valueOf'])
const { toString, constructor, name } = params
console.log(JSON.stringify({ keys: Object.keys(params), toString, constructor, proto: params['__proto__'], name, valueOf: params.valueOf === undefined, plain: Object.getPrototypeOf(params) === Object.prototype }))
`,
  )
  const ran = spawnSync(bun, [script], { encoding: 'utf8', timeout: CHILD_PROCESS_TIMEOUT_MS })

  // A child that hung is killed at the bound: its ETIMEDOUT error and signal, not stdout it never wrote, report it
  expect({ error: ran.error, status: ran.status, signal: ran.signal }).toEqual({ error: undefined, status: 0, signal: null })
  expect(ran.stderr).toBe('')
  expect(JSON.parse(ran.stdout)).toEqual({
    keys: ['toString', 'constructor', '__proto__', 'name', 'valueOf'],
    toString: 'a',
    constructor: 'b',
    proto: 'c',
    name: 'd',
    valueOf: true,
    plain: true,
  })
}, CHILD_PROCESS_CASE_TIMEOUT_MS)
