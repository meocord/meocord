import { applyDecorators, createMetadata, Logger, SetMetadata } from '@src/common/index.js'
import {
  Autocomplete,
  Catch,
  Command,
  CommandBuilder,
  Controller,
  Cooldown,
  Defer,
  Guard,
  Inject,
  Interceptor,
  MeoCord,
  MessageHandler,
  Observer,
  On,
  Once,
  Pipe,
  ReactionHandler,
  Service,
  UseFilter,
  UseGuard,
  UseInterceptor,
  UsePipe,
  UseTheme,
  Validate,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type StandardSchemaV1 } from '@src/interface/index.js'
import { META } from '@src/util/metadata-keys.js'
import { EXPERIMENTAL_DECORATORS_FIX, isRefusal, setStartupErrorsMode } from '@src/util/refusal.util.js'

// The classes the decorators below name, applied as TypeScript's experimental decorators
@Guard()
class AllowGuard {
  canActivate() {
    return true
  }
}

@Interceptor()
class PassInterceptor {
  intercept() {}
}

@Catch(Error)
class AnyFilter {
  catch() {}
}

@Pipe()
class TrimPipe {
  transform(value: unknown) {
    return value
  }
}

@CommandBuilder(CommandType.SLASH)
class PingBuilder {
  build() {
    return {} as never
  }
}

const anything: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) } }
const Roles = createMetadata<string[]>('Roles')

/** A decorator's arguments as a runtime gives a standard (TC39) decorator: the value, then a context object. */
type StandardDecorator = (value: unknown, context: object) => unknown

/** `decorator`, called as a runtime calls a standard decorator. */
const standard = (decorator: unknown) => decorator as StandardDecorator

/** The context object a runtime passes a standard decorator of `kind`, applied to a declaration named `name`. */
const contextOf = (kind: 'class' | 'method' | 'field', name: string) => ({
  kind,
  name,
  metadata: {},
  addInitializer() {},
  ...(kind !== 'class' && { static: false, private: false, access: { has: () => true, get: () => undefined } }),
})

/** The error MeoCord throws for `decorator` applied as a standard decorator to `declaration`. */
const refusal = (declaration: string, decorator: string) =>
  new Error(`${declaration}: ${decorator} ran as a standard (TC39) decorator. ${EXPERIMENTAL_DECORATORS_FIX}.`)

const CLASS_DECORATORS: [string, () => unknown][] = [
  ['@Service', () => Service()],
  ['@Controller', () => Controller()],
  ['@Guard', () => Guard()],
  ['@Interceptor', () => Interceptor()],
  ['@Catch', () => Catch(Error)],
  ['@Pipe', () => Pipe()],
  ['@Observer', () => Observer()],
  ['@CommandBuilder', () => CommandBuilder(CommandType.SLASH)],
  ['@MeoCord', () => MeoCord({ controllers: [], clientOptions: { intents: [] } })],
]

const METHOD_DECORATORS: [string, () => unknown][] = [
  ['@Command', () => Command('ping', PingBuilder)],
  ['@Autocomplete', () => Autocomplete('ping', 'topic')],
  ['@MessageHandler', () => MessageHandler('ping')],
  ['@ReactionHandler', () => ReactionHandler('👍')],
  ['@On', () => On('messageCreate')],
  ['@Once', () => Once('messageCreate')],
  ['@Defer', () => Defer()],
  ['@Validate', () => Validate(anything)],
  ['@UsePipe', () => UsePipe('id', TrimPipe)],
]

// Decorators that go on a class or on a method
const EITHER: [string, () => unknown][] = [
  ['@UseGuard', () => UseGuard(AllowGuard)],
  ['@UseInterceptor', () => UseInterceptor(PassInterceptor)],
  ['@UseFilter', () => UseFilter(AnyFilter)],
  ['@Cooldown', () => Cooldown({ seconds: 1 })],
  ['@UseTheme', () => UseTheme({ colors: { primary: '#000001' } })],
  ['@SetMetadata', () => SetMetadata('key', 'value')],
  ['a decorator made by createMetadata', () => Roles(['admin'])],
  ['a decorator made by applyDecorators', () => applyDecorators(Cooldown({ seconds: 1 }))],
]

describe('a MeoCord decorator applied as a standard (TC39) decorator', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  it.each([...CLASS_DECORATORS, ...EITHER])('throws for %s on a class, naming the class and the compiler options to set', (name, make) => {
    class Target {}
    const apply = () => standard(make())(Target, contextOf('class', 'Target'))

    expect(apply).toThrow(refusal('Target', name))
  })

  it.each([...METHOD_DECORATORS, ...EITHER])('throws for %s on a method, naming the method and the compiler options to set', (name, make) => {
    const ping = async () => {}
    const apply = () => standard(make())(ping, contextOf('method', 'ping'))

    expect(apply).toThrow(refusal('the method ping', name))
  })

  it('throws for @Inject on a field, naming the field', () => {
    const apply = () => standard(Inject('token'))(undefined, contextOf('field', 'notes'))

    expect(apply).toThrow(refusal('the field notes', '@Inject'))
  })

  // A method decorator once read the context as a property key, warned it was on a static method, then threw a TypeError
  it('throws the refusal, not a TypeError from inside MeoCord, for @Command on a method', () => {
    let thrown: unknown
    try {
      standard(Command('ping', PingBuilder))(async () => {}, contextOf('method', 'ping'))
    } catch (error) {
      thrown = error
    }

    expect(thrown).not.toBeInstanceOf(TypeError)
    expect(isRefusal(thrown)).toBe(true)
    expect(Logger.prototype.warn).not.toHaveBeenCalled()
  })

  // Bun gives an anonymous class expression the name '', a runtime may give it none
  it.each([
    ['no name', undefined],
    ['an empty name', ''],
  ])('names a class with %s as anonymous', (_case, name) => {
    const apply = () => standard(Service())(class {}, { ...contextOf('class', ''), name })

    expect(apply).toThrow(refusal('an anonymous class', '@Service'))
  })

  it('names a method by its symbol', () => {
    const apply = () => standard(Defer())(async () => {}, { ...contextOf('method', ''), name: Symbol('run') })

    expect(apply).toThrow(refusal('the method Symbol(run)', '@Defer'))
  })

  it("throws at once with startupErrors: 'all', as it applies nothing to keep the error on", () => {
    setStartupErrorsMode('all')
    try {
      expect(() => standard(Guard())(class Late {}, contextOf('class', 'Late'))).toThrow(refusal('Late', '@Guard'))
    } finally {
      setStartupErrorsMode('first')
    }
  })
})

describe('a MeoCord decorator applied as an experimental decorator', () => {
  it('applies to a class as before, with no warning', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')

    @Guard()
    class Allowed {}

    @Roles(['admin'])
    class Admin {}

    expect(Reflect.getMetadata(META.guardClass, Allowed)).toBe(true)
    expect(Reflect.getMetadata(Roles.key, Admin)).toEqual(['admin'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('applies to a method as before, with no warning', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn')

    class Handlers {
      @Roles(['admin'])
      @Cooldown({ seconds: 1 })
      run() {}
    }

    expect(Reflect.getMetadata(Roles.key, Handlers.prototype, 'run')).toEqual(['admin'])
    expect(Reflect.getMetadataKeys(Handlers.prototype, 'run').length).toBeGreaterThan(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
