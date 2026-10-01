import { describe, expectTypeOf, it } from 'vitest'
import { MeoCordFactory, type MeoCordApplication } from '@src/core/index.js'

/** Runs under `vitest --typecheck`. */

class App {}

describe('MeoCordFactory.create', () => {
  it('returns an application a 4.0 main.ts can start and register commands with', async () => {
    const app = MeoCordFactory.create(App)

    expectTypeOf(app).toEqualTypeOf<MeoCordApplication>()
    expectTypeOf(app.start).returns.toEqualTypeOf<Promise<void>>()
    expectTypeOf(app.registerCommands).returns.toEqualTypeOf<Promise<void>>()
  })

  it('returns an application a bot can stop without ending its process', () => {
    expectTypeOf(MeoCordFactory.create(App).stop).returns.toEqualTypeOf<Promise<void>>()
  })
})
