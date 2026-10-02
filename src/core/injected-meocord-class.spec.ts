import { MeoCord, Service } from '@src/decorator/index.js'
import { Logger, UserError } from '@src/common/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

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
})
