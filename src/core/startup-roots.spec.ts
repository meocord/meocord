import { vi } from 'vitest'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))

const { Container } = await import('inversify')
const { ButtonInteraction, Client } = await import('discord.js')
const { MeoCordFactory } = await import('@src/core/meocord-factory.js')
const { Catch, Command, Controller, Guard, Interceptor, MeoCord, Observer, On, Pipe, Service, UseGuard, UseInterceptor, UsePipe } = await import('@src/decorator/index.js')
const { Translator } = await import('@src/common/translator.js')
const { CommandType } = await import('@src/enum/index.js')
const { createMockInteraction, MeoCordTestingModule } = await import('@src/testing/index.js')
const { bindShared } = await import('@src/core/interceptor-runner.js')
const { markStartupChecked } = await import('@src/core/startup-checked.js')

@Service()
class Clock {
  now() {
    return 1
  }
}

/** A class of `role` whose constructor injects `dependency`, its type recorded as TypeScript records it for a decorated class. */
function injecting(role: 'guard' | 'interceptor' | 'filter' | 'pipe' | 'presenter', dependency: unknown, decorate = true) {
  class Stage {
    constructor(readonly dependency: unknown) {}
    canActivate() {
      return true
    }
    intercept(_context: unknown, next: { handle(): unknown }) {
      return next.handle()
    }
    transform(value: unknown) {
      return value
    }
    catch() {}
    loading() {
      return { text: '…' }
    }
    error() {
      return { text: 'Oops' }
    }
  }
  if (decorate) {
    // Recorded first, as TypeScript emits it beside the class decorator, which reads it
    Reflect.defineMetadata('design:paramtypes', [dependency], Stage)
    const decorator = { guard: Guard(), interceptor: Interceptor(), filter: Catch(), pipe: Pipe(), presenter: Service() }[role] as ClassDecorator
    decorator(Stage)
  }
  return Stage
}

/** A controller whose one button handler `decorator` decorates. */
function controllerUsing(decorator?: MethodDecorator) {
  @Controller()
  class Panel {
    @Command('panel', CommandType.BUTTON)
    panel() {}
  }
  decorator?.(Panel.prototype, 'panel', Object.getOwnPropertyDescriptor(Panel.prototype, 'panel')!)
  return Panel
}

/** A service whose one `@On` handler `decorator` decorates. */
function serviceListening(decorator: MethodDecorator) {
  @Service()
  class Audit {
    @On('guildCreate')
    joined() {}
  }
  decorator(Audit.prototype, 'joined', Object.getOwnPropertyDescriptor(Audit.prototype, 'joined')!)
  return Audit
}

/** Where each kind of class an app runs is placed, with `cls` put there. */
const PLACES = {
  'a global guard': (cls: any) => ({ controllers: [controllerUsing()], guards: [cls] }),
  'a guard on a handler': (cls: any) => ({ controllers: [controllerUsing(UseGuard(cls) as MethodDecorator)] }),
  'an interceptor': (cls: any) => ({ controllers: [controllerUsing(UseInterceptor(cls) as MethodDecorator)] }),
  'a global filter': (cls: any) => ({ controllers: [controllerUsing()], filters: [cls] }),
  'a pipe': (cls: any) => ({ controllers: [controllerUsing((UsePipe as any)('value', cls) as MethodDecorator)] }),
  'the presenter': (cls: any) => ({ controllers: [controllerUsing()], presenter: cls }),
  'an interceptor on a service event handler': (cls: any) => ({ services: [serviceListening(UseInterceptor(cls) as MethodDecorator)] }),
} as const
const ROLE = {
  'a global guard': 'guard',
  'a guard on a handler': 'guard',
  'an interceptor': 'interceptor',
  'a global filter': 'filter',
  'a pipe': 'pipe',
  'the presenter': 'presenter',
  'an interceptor on a service event handler': 'interceptor',
} as const

function appWith(options: object) {
  @MeoCord({ controllers: [], clientOptions: { intents: [] }, ...options } as never)
  class App {}
  return App
}

const CREATE = [
  ['MeoCordFactory.create', (app: any) => MeoCordFactory.create(app)],
  ['the testing module', (app: any) => MeoCordTestingModule.fromApp(app).compile()],
] as const

describe('every class an app runs, checked as it is created', () => {
  const places = Object.keys(PLACES) as (keyof typeof PLACES)[]

  it.each(CREATE.flatMap(([where, create]) => places.map(place => [where, place, create] as const)))(
    '%s refuses %s that injects Translator with no i18n',
    (_where, place, create) => {
      const cls = injecting(ROLE[place], Translator)
      expect(() => create(appWith(PLACES[place](cls)))).toThrow(
        new Error(`${cls.name}: it injects Translator, but @MeoCord has no i18n. Pass @MeoCord({ i18n: t }), where t comes from createTranslator.`),
      )
    },
  )

  it.each(CREATE)('%s refuses an undecorated presenter that injects, naming the decorator to add', (_where, create) => {
    const Presenter = injecting('presenter', Clock, false)
    expect(() => create(appWith(PLACES['the presenter'](Presenter)))).toThrow(
      new Error(
        `${Presenter.name}: its constructor takes parameters, but ${Presenter.name} has no decorator, so TypeScript recorded none of their ` +
          'types and it cannot be created. Decorate it with @Service(), or give a class from a package a provider in @MeoCord({ providers }).',
      ),
    )
  })

  it.each(CREATE)('%s refuses an undecorated guard on a service method, which runs at a direct call', (_where, create) => {
    const Owner = injecting('guard', Clock, false)
    @Service()
    class Billing {
      @UseGuard(Owner as never)
      charge() {}
    }
    expect(() => create(appWith({ services: [Billing] }))).toThrow(`${Owner.name}: its constructor takes parameters, but ${Owner.name} has no decorator`)
  })

  it('names, in a testing module, a guard that injects the Client the module does not make', async () => {
    const Owner = injecting('guard', Client)
    const Panel = controllerUsing(UseGuard(Owner) as MethodDecorator)
    const module = MeoCordTestingModule.fromApp(appWith({ controllers: [Panel] })).compile()

    await expect(module.invoke(Panel, 'panel', createMockInteraction(ButtonInteraction, { customId: 'panel' }))).rejects.toThrow(
      `${Owner.name} injects the Discord Client, which a testing module does not make`,
    )
  })

  it('runs a decorated guard on a service method, and one on a controller method that is no handler, at a direct call', async () => {
    const seen: string[] = []
    @Guard()
    class Allow {
      constructor(readonly clock: Clock) {}
      canActivate() {
        seen.push('guard')
        return true
      }
    }
    @Service()
    class Billing {
      @UseGuard(Allow)
      async charge(_interaction: unknown) {
        seen.push('charge')
      }
    }
    @Controller()
    class Panel {
      constructor(readonly billing: Billing) {}
      @UseGuard(Allow)
      async helper(_interaction: unknown) {
        seen.push('helper')
      }
    }
    const module = MeoCordTestingModule.fromApp(appWith({ controllers: [Panel], services: [Billing] })).compile()
    const press = createMockInteraction(ButtonInteraction, { customId: 'x' })

    await module.get(Billing).charge(press)
    await module.get(Panel).helper(press)

    expect(seen).toEqual(['guard', 'charge', 'guard', 'helper'])
  })

  // Every class MeoCord binds was checked as the app was created: one bound without that is a root a check missed
  it('refuses to bind a class the startup checks never saw', () => {
    const container = new Container()
    markStartupChecked(container, [Clock], () => {})
    class Missed {}

    expect(() => bindShared(container, Clock)).not.toThrow()
    expect(() => bindShared(container, Missed)).toThrow('Missed: MeoCord binds it without checking it as the app is created')
  })
})

describe('a guarded method called directly', () => {
  const runs: string[] = []
  beforeEach(() => {
    runs.length = 0
  })

  @Guard()
  class Staff {
    constructor(readonly clock: Clock) {}
    canActivate() {
      runs.push('guard')
      return true
    }
  }
  const press = () => createMockInteraction(ButtonInteraction, { customId: 'panel' })

  // A subclass the app makes itself, from a handler, of a class MeoCord made: its guards are met only at the call
  it('runs a guard first met on an instance the app made itself, checking it then', async () => {
    @Controller()
    class Panel {
      @Command('panel', CommandType.BUTTON)
      async panel(interaction: unknown) {
        await new Extra().extra(interaction)
      }
    }
    class Extra extends Panel {
      @UseGuard(Staff)
      async extra(_interaction: unknown) {
        runs.push('extra')
      }
    }
    const Undecorated = injecting('guard', Clock, false)
    class Unchecked extends Panel {
      @UseGuard(Undecorated as never)
      async unchecked(_interaction: unknown) {}
    }
    const module = MeoCordTestingModule.fromApp(appWith({ controllers: [Panel] })).compile()

    await module.invoke(Panel, 'panel', press())
    expect(runs).toEqual(['guard', 'extra'])
    await expect(new Unchecked().unchecked(press())).rejects.toThrow(`${Undecorated.name}: its constructor takes parameters, but ${Undecorated.name} has no decorator`)
  })

  it.each([
    [
      "a provider's class",
      () => {
        class Billing {
          @UseGuard(Staff)
          async charge(_interaction: unknown) {
            runs.push('charge')
          }
        }
        Service()(Billing)
        return { options: { providers: [{ provide: 'billing', useClass: Billing }] }, run: (module: any) => module.get('billing').charge(press()) }
      },
    ],
    [
      'a service only a guard injects',
      () => {
        @Service()
        class Ledger {
          @UseGuard(Staff)
          async charge(_interaction: unknown) {
            runs.push('charge')
          }
        }
        // The guard calls the service's guarded method itself, on the instance its own resolution made
        @Guard()
        class Audits {
          constructor(readonly ledger: Ledger) {}
          async canActivate(interaction: unknown) {
            await this.ledger.charge(interaction)
            return true
          }
        }
        const Panel = controllerUsing(UseGuard(Audits) as MethodDecorator)
        return { options: { controllers: [Panel] }, run: (module: any) => module.invoke(Panel, 'panel', press()) }
      },
    ],
    [
      'an observer',
      () => {
        @Observer()
        class Watch {
          onSettled() {}
          @UseGuard(Staff)
          async charge(_interaction: unknown) {
            runs.push('charge')
          }
        }
        return { options: { observers: [Watch] }, run: (module: any) => module.get(Watch).charge(press()) }
      },
    ],
  ])('runs its guards on %s, which MeoCord made', async (_kind, build) => {
    const { options, run } = build()
    const module = MeoCordTestingModule.fromApp(appWith(options)).compile()
    await run(module)
    expect(runs).toEqual(['guard', 'charge'])
  })

  it('says what to do on an instance of a class MeoCord never made, rather than failing inside', async () => {
    class Loose {
      @UseGuard(Staff)
      async go(_interaction: unknown) {}
    }
    MeoCordTestingModule.fromApp(appWith({ controllers: [controllerUsing()] })).compile()
    await expect(new Loose().go(press())).rejects.toThrow(new Error(
      'Loose.go: @UseGuard runs its guards through the app that made Loose, and this instance was made outside one. Inject Loose, or call it on an instance the app made.',
    ))
  })
})
