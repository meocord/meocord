import { describe, expectTypeOf, it } from 'vitest'
import { type Jsonified, ShardContext, type ShardCallResult } from '@src/core/index.js'

/**
 * Runs under `vitest --typecheck`. The negative cases use `@ts-expect-error`,
 * which fails once the rejected form starts compiling.
 */

class Money {
  constructor(readonly cents: number) {}
  toJSON(): string {
    return `${this.cents / 100}`
  }
}

interface Report {
  id: number
  at: Date
  totals: Map<string, number>
  render: () => string
  note?: string
  gone: undefined
  tags: (string | undefined)[]
  price: Money
}

class StatsService {
  guildCount(): number {
    return 0
  }
  report(): Report {
    throw new Error('not run')
  }
  lastSeen(): Date {
    return new Date()
  }
  forget(): void {
    void this.label
  }
  async greet(name: string, times: number): Promise<string> {
    return name.repeat(times)
  }
  readonly label = 'stats'
}

declare const shards: ShardContext

describe('ShardContext.call', () => {
  it("types each result from the method's awaited return", () => {
    expectTypeOf(shards.call(StatsService, 'guildCount')).resolves.toEqualTypeOf<ShardCallResult<number>[]>()
    expectTypeOf(shards.call(StatsService, 'greet', 'hi', 2)).resolves.toEqualTypeOf<ShardCallResult<string>[]>()
  })

  // Every mode passes the result through JSON, so its type is what JSON gives back
  it("types a result as JSON gives it back: a Date as a string, a Map as {}, functions and undefined left out", () => {
    expectTypeOf(shards.call(StatsService, 'lastSeen')).resolves.toEqualTypeOf<ShardCallResult<string>[]>()
    expectTypeOf(shards.call(StatsService, 'forget')).resolves.toEqualTypeOf<ShardCallResult<undefined>[]>()
    expectTypeOf<Jsonified<Report>>().toEqualTypeOf<{
      id: number
      at: string
      totals: Record<string, never>
      note?: string
      tags: (string | null)[]
      price: string
    }>()
    expectTypeOf<Jsonified<bigint>>().toBeNever()
  })

  it('refuses a name that is not a method, and arguments the method does not take', () => {
    // @ts-expect-error label is a property, not a method
    void shards.call(StatsService, 'label')
    // @ts-expect-error no such method
    void shards.call(StatsService, 'missing')
    // @ts-expect-error greet takes a string and a number
    void shards.call(StatsService, 'greet', 'hi')
    // @ts-expect-error greet takes a string and a number
    void shards.call(StatsService, 'greet', 2, 'hi')
  })

  it('narrows a result to its value or its error', async () => {
    const [result] = await shards.call(StatsService, 'guildCount')
    if (result.ok) expectTypeOf(result.value).toEqualTypeOf<number>()
    else expectTypeOf(result.error).toEqualTypeOf<string>()
  })
})
