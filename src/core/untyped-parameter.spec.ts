import { vi } from 'vitest'

vi.mock('@src/common/logger.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = vi.fn()
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))

const { MeoCordFactory } = await import('@src/core/meocord-factory.js')
const { MeoCord, Controller, Service, Inject, Command, UseGuard, UseInterceptor, UsePipe } = await import('@src/decorator/index.js')
const { CommandType } = await import('@src/enum/index.js')
const { meocordClasses, meocordClassAdvice } = await import('@src/core/meocord-classes.js')
const { MeoCordTestingModule } = await import('@src/testing/meocord-testing-module.js')

// What a class's constructor types read as when one is an interface, an `import type`, or a class
// whose module has not finished loading, as in two services that import each other
interface NoteStore {
  save(): void
}

const explanation = (cls: string, injectedBy?: string) =>
  `${cls}: parameter 1 of its constructor has no runtime type, so it cannot be created. Usually ${cls} and a class it ` +
  `injects import each other${injectedBy ? ` (${injectedBy})` : ''}, or the parameter is typed with an interface ` +
  'or an `import type`. Move what they both need into a third service, or inject the parameter with @Inject(token).'

function appWith(options: { controllers?: any[]; services?: any[]; providers?: any[]; guards?: any[]; interceptors?: any[]; filters?: any[]; themeFor?: any }) {
  @MeoCord({ controllers: [], ...options, clientOptions: { intents: [] } })
  class App {}
  return App
}

describe('a constructor parameter with no runtime type', () => {
  it('fails MeoCordFactory.create, naming the class, the parameter and the classes that inject it', () => {
    @Service()
    class Notes {
      constructor(readonly storage: NoteStore) {}
    }
    @Controller()
    class NotesController {
      constructor(readonly notes: Notes) {}
    }

    expect(() => MeoCordFactory.create(appWith({ controllers: [NotesController] }))).toThrow(
      explanation('Notes', 'NotesController injects Notes'),
    )
  })

  it('names every class that injects it, and none when nothing does', () => {
    @Service()
    class Notes {
      constructor(readonly storage: NoteStore) {}
    }
    @Controller()
    class Reader {
      constructor(readonly notes: Notes) {}
    }
    @Controller()
    class Writer {
      constructor(readonly notes: Notes) {}
    }
    @Service()
    class Scheduler {
      constructor(readonly storage: NoteStore) {}
    }

    expect(() => MeoCordFactory.create(appWith({ controllers: [Reader, Writer] }))).toThrow(
      explanation('Notes', 'Reader and Writer inject Notes'),
    )
    expect(() => MeoCordFactory.create(appWith({ services: [Scheduler] }))).toThrow(explanation('Scheduler'))
  })

  it('reads an undefined type the same way', () => {
    @Service()
    class Notes {
      constructor(readonly storage: unknown) {}
    }
    Reflect.defineMetadata('design:paramtypes', [undefined], Notes)

    expect(() => MeoCordFactory.create(appWith({ services: [Notes] }))).toThrow(explanation('Notes'))
  })

  it('accepts the parameter once @Inject gives it a token', () => {
    @Service()
    class Notes {
      constructor(@Inject('storage') readonly storage: NoteStore) {}
    }

    expect(() =>
      MeoCordFactory.create(appWith({ services: [Notes], providers: [{ provide: 'storage', useValue: { save() {} } }] })),
    ).not.toThrow()
  })

  it('leaves alone a class a provider stands in for, which is never constructed', () => {
    @Service()
    class Settings {
      constructor(readonly store: NoteStore) {}
    }
    @Controller()
    class SettingsController {
      constructor(readonly settings: Settings) {}
    }
    const providers = [{ provide: Settings, useValue: { store: { save() {} } } }]

    expect(() => MeoCordFactory.create(appWith({ controllers: [SettingsController], providers }))).not.toThrow()
    expect(() => MeoCordTestingModule.create({ controllers: [SettingsController], providers }).compile()).not.toThrow()
  })

  it('fails the testing module the same way', () => {
    @Service()
    class Notes {
      constructor(readonly storage: NoteStore) {}
    }
    @Controller()
    class NotesController {
      constructor(readonly notes: Notes) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [NotesController] }).compile()).toThrow(
      explanation('Notes', 'NotesController injects Notes'),
    )
  })
})

describe('a class with no decorator', () => {
  const undecorated = (cls: string, advice = 'Decorate it with @Service(), or give a class from a package a provider in @MeoCord({ providers }).') =>
    `${cls}: its constructor takes parameters, but ${cls} has no decorator, so TypeScript recorded none of their types ` +
    `and it cannot be created. ${advice}`

  @Service()
  class Clock {
    now() {
      return 1
    }
  }

  // As TypeScript leaves a class with no decorator: no record of its constructor's types
  class Reminders {
    constructor(readonly clock: Clock) {}
  }

  @Service()
  class Base {
    constructor(readonly clock: Clock) {}
  }

  it.each([
    ['MeoCordFactory.create', (options: object) => MeoCordFactory.create(appWith(options))],
    ['the testing module', (options: object) => MeoCordTestingModule.fromApp(appWith(options)).compile()],
  ])('is refused by %s when its constructor injects, naming it and the decorator to add', (_where, create) => {
    expect(() => create({ services: [Reminders] })).toThrow(new Error(undecorated('Reminders')))
  })

  it('is refused as a themeFor class, which the app resolves like a service', () => {
    class Themes {
      constructor(readonly clock: Clock) {}
      user() {
        return undefined
      }
    }
    expect(() => MeoCordTestingModule.fromApp(appWith({ themeFor: Themes } as object)).compile()).toThrow(new Error(undecorated('Themes')))
  })

  it('is refused naming @Controller() when it is listed as a controller', () => {
    class Panel {
      constructor(readonly clock: Clock) {}
      @Command('panel', CommandType.BUTTON)
      panel() {}
    }
    expect(() => MeoCordFactory.create(appWith({ controllers: [Panel] }))).toThrow(new Error(undecorated('Panel', 'Decorate it with @Controller().')))
  })

  // A guard runs per call, so without this it fails only at the first call; the others as the app is created
  it.each([
    ['a guard on a handler', '@Guard()', (cls: any) => ({ controllers: [handlerUsing(UseGuard(cls) as MethodDecorator)] })],
    ['a global guard', '@Guard()', (cls: any) => ({ guards: [cls] })],
    ['an interceptor', '@Interceptor()', (cls: any) => ({ controllers: [handlerUsing(UseInterceptor(cls) as MethodDecorator)] })],
    ['a pipe', '@Pipe()', (cls: any) => ({ controllers: [handlerUsing((UsePipe as any)('value', cls) as MethodDecorator)] })],
    ['a global filter', '@Catch()', (cls: any) => ({ filters: [cls] })],
  ])('is refused naming %s\'s decorator, before any call', (_role, decorator, options) => {
    class Stage {
      constructor(readonly clock: Clock) {}
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
    }
    expect(() => MeoCordTestingModule.fromApp(appWith(options(Stage))).compile()).toThrow(new Error(undecorated('Stage', `Decorate it with ${decorator}.`)))
  })

  it('is refused when it has a constructor of its own over a decorated base, taking more than the base records', () => {
    class Later extends Base {
      constructor(
        clock: Clock,
        readonly delay: Clock,
      ) {
        super(clock)
      }
    }
    expect(() => MeoCordFactory.create(appWith({ services: [Later] }))).toThrow(new Error(undecorated('Later')))
  })

  it.each([
    [
      'a parameter with a default value, which its constructor does not count',
      class Defaults {
        constructor(readonly clock = new Clock()) {}
      },
    ],
    [
      'a rest parameter',
      class Rest {
        readonly clocks: Clock[]
        constructor(...clocks: Clock[]) {
          this.clocks = clocks
        }
      },
    ],
    ['no constructor of its own over a decorated base, whose types it takes', class Inherits extends Base {}],
    [
      'a constructor of its own over a decorated base, taking the same types',
      class Same extends Base {
        constructor(clock: Clock) {
          super(clock)
        }
      },
    ],
  ] as [string, new (...args: any[]) => object][])('is created as before with %s', (_case, cls) => {
    const module = MeoCordTestingModule.fromApp(appWith({ services: [cls] })).compile()
    expect(module.get(cls)).toBeInstanceOf(cls)
    expect(() => MeoCordFactory.create(appWith({ services: [cls] }))).not.toThrow()
  })

  it('leaves a decorated class as it was, its types recorded', () => {
    @Service()
    class Decorated {
      constructor(readonly clock: Clock) {}
    }
    const module = MeoCordTestingModule.fromApp(appWith({ services: [Decorated, Base] })).compile()
    expect(module.get(Decorated).clock).toBe(module.get(Clock))
    expect(module.get(Base).clock).toBe(module.get(Clock))
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

/** A controller whose one handler `decorator` decorates. */
function handlerUsing(decorator: MethodDecorator) {
  @Controller()
  class Staged {
    @Command('staged', CommandType.BUTTON)
    staged() {}
  }
  decorator(Staged.prototype, 'staged', Object.getOwnPropertyDescriptor(Staged.prototype, 'staged')!)
  return Staged
}
