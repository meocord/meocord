import { vi } from 'vitest'
import { inspect, stripVTControlCharacters } from 'node:util'
import { Client } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { resetLogLevel } from '@src/common/log-level.js'

const CONSOLE_METHODS = ['log', 'warn', 'error', 'debug'] as const

/** Each console line printed, as text without colour, by the console method that printed it. */
let printed: { method: (typeof CONSOLE_METHODS)[number]; line: string }[]

beforeEach(() => {
  vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
  resetLogLevel()
  printed = []
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push({ method, line: stripVTControlCharacters(args.map(String).join(' ')) })
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resetLogLevel()
})

/** What follows the timestamp, the tag and the context on a line. */
const body = (line: string) => line.replace(/^.*?\[Ctx\] /, '')

const throwInspect = () => {
  throw new Error('inspect.custom')
}

/** Values whose inspection runs code of theirs: each prints, whether that code throws on this runtime or not. */
const VALUES: [name: string, make: () => unknown][] = [
  ['its own [util.inspect.custom] throws', () => ({ [inspect.custom]: throwInspect })],
  [
    'a Proxy whose every trap throws',
    () =>
      new Proxy(
        {},
        {
          get: throwInspect,
          getPrototypeOf: throwInspect,
          ownKeys: throwInspect,
          getOwnPropertyDescriptor: throwInspect,
          has: throwInspect,
        },
      ),
  ],
  ['an error whose message getter throws', () => Object.defineProperty(new Error('x'), 'message', { get: throwInspect })],
  ['a class whose static name getter throws', () => class { static get name(): string { return throwInspect() } }],
  ['a getter on Symbol.toStringTag that throws', () => ({ get [Symbol.toStringTag]() { return throwInspect() } })],
  ['an error whose stack getter throws', () => Object.defineProperty(new Error('x'), 'stack', { get: throwInspect })],
  ['an AggregateError whose errors getter throws', () => Object.defineProperty(new AggregateError([], 'x'), 'errors', { get: throwInspect })],
]

const LEVELS = [
  ['log', 'log'],
  ['info', 'log'],
  ['verbose', 'log'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
] as const

describe('a value whose inspection throws', () => {
  describe.each(LEVELS)('at %s', (level, method) => {
    it.each(VALUES)('prints one line with the rest of the arguments when %s', (_name, make) => {
      expect(() => new Logger('Ctx')[level]('Failed:', make(), 'after')).not.toThrow()

      expect(printed).toHaveLength(1)
      expect(printed[0].method).toBe(method)
      expect(body(printed[0].line)).toMatch(/^Failed: .+ after$/s)
    })
  })

  it('prints a placeholder naming what inspecting it threw', () => {
    new Logger('Ctx').error('Failed:', { [inspect.custom]: throwInspect })

    expect(body(printed[0].line)).toBe('Failed: [value could not be inspected: inspect.custom]')
  })

  it.each([
    ['a string', 'disk full', ': disk full'],
    ['a number', 42, ': 42'],
    ['undefined', undefined, ': undefined'],
    ['an object with no message', { code: 1 }, ''],
  ])('names %s it throws as text, or nothing', (_name, thrown, named) => {
    new Logger('Ctx').error('Failed:', {
      [inspect.custom]: () => {
        throw thrown
      },
    })

    expect(body(printed[0].line)).toBe(`Failed: [value could not be inspected${named}]`)
  })

  it('reads nothing of what it throws that would run code: a getter or a Proxy', () => {
    const reads = vi.fn(() => 'read')
    const getter = Object.defineProperty(new Error(), 'message', { get: reads })
    const proxy = new Proxy(new Error('hidden'), { get: reads, getOwnPropertyDescriptor: () => (reads(), undefined) })

    for (const thrown of [getter, proxy]) {
      new Logger('Ctx').error('Failed:', {
        [inspect.custom]: () => {
          throw thrown
        },
      })
    }

    expect(printed.map(({ line }) => body(line))).toEqual(['Failed: [value could not be inspected]', 'Failed: [value could not be inspected]'])
    expect(reads).not.toHaveBeenCalled()
  })
})

describe('a value that prints today', () => {
  const printedAs = (value: unknown) => {
    new Logger('Ctx').log(value)
    return body(printed.at(-1)!.line)
  }

  it('prints a Symbol and a circular object as console.log does', () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    expect(printedAs(Symbol('x'))).toBe('Symbol(x)')
    expect(printedAs(circular)).toBe("<ref *1> { name: 'loop', self: [Circular *1] }")
  })

  it('prints an error with its stack, own properties and cause', () => {
    const error = Object.assign(new Error('outer', { cause: new Error('inner') }), { code: 'E_X' })

    const line = printedAs(error)

    expect(line).toBe(inspect(error, { depth: 4 }))
    expect(line).toMatch(/^Error: outer\n {4}at /)
    expect(line).toContain("code: 'E_X'")
    expect(line).toContain('[cause]: Error: inner')
  })

  it('prints a discord.js object four levels deep', () => {
    const client = new Client({ intents: [] })

    expect(printedAs(client)).toBe(inspect(client, { depth: 4 }))
    void client.destroy()
  })
})
