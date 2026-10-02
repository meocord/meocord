import { MeoCord, Service } from '@src/decorator/index.js'
import { Logger, UserError } from '@src/common/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'
import { meocordClassAdvice, meocordClasses } from '@src/core/meocord-classes.js'

@Service()
class Audit {
  constructor(readonly logger: Logger) {}
}

@Service()
class Rejects {
  constructor(readonly error: UserError) {}
}

describe("one of MeoCord's classes an app makes itself, injected", () => {
  it.each([
    ['Logger', Audit, 'Logger: MeoCord does not inject it; create it with `new Logger(…)`.'],
    ['an error', Rejects, 'UserError: MeoCord does not inject it; create it with `new UserError(…)` where it is thrown.'],
  ])('is refused as the app is created, saying what to do instead, for %s', (_kind, service, message) => {
    @MeoCord({ controllers: [], services: [service], clientOptions: { intents: [] } })
    class App {}

    expect(() => MeoCordTestingModule.fromApp(App).compile()).toThrow(new Error(message))
  })

  // Every exported class the check would refuse is one MeoCord binds itself, or one with advice of its own
  it("knows every one of MeoCord's exported classes it would refuse, by the class itself", async () => {
    const entries: Record<string, unknown>[] = await Promise.all([
      import('@src/core/index.js'),
      import('@src/decorator/index.js'),
      import('@src/common/index.js'),
      import('@src/interface/index.js'),
      import('@src/enum/index.js'),
      import('@src/testing/index.js'),
    ])
    const refused = entries
      .flatMap(entry => Object.values(entry))
      .filter((value): value is new (...args: any[]) => unknown => typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value)))
      .filter(cls => cls.length > ((Reflect.getMetadata('design:paramtypes', cls) as unknown[] | undefined)?.length ?? 0))
    expect(refused.length).toBeGreaterThan(0)
    for (const cls of refused) expect([cls.name, meocordClasses().includes(cls) || meocordClassAdvice(cls) !== undefined]).toEqual([cls.name, true])
  })
})
