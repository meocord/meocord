import { describe, expectTypeOf, it } from 'vitest'
import { Catch, Guard, Interceptor, MeoCord, type MeoCordOptions, Observer, Validate } from '@src/decorator/index.js'
import { type CommandType } from '@src/enum/index.js'
import {
  type CommandBuildResult,
  type ExceptionFilter,
  type GuardInterface,
  type GuardOptions,
  type InterceptorInterface,
  type InterceptorOptions,
  type ObserverOptions,
  type PrimaryEntryPointCommandData,
  type StandardSchemaV1,
  type PipeInterface,
  type ValidateOptions,
  type ValidatePipes,
} from '@src/interface/index.js'

/** Runs under `vitest --typecheck`: each decorator's options have a name an app can use, as a wrapper needs. */
describe('named decorator options', () => {
  it('are what each stage decorator takes', () => {
    expectTypeOf<Parameters<typeof Guard>[0]>().toEqualTypeOf<GuardOptions | undefined>()
    expectTypeOf<Parameters<typeof Interceptor>[0]>().toEqualTypeOf<InterceptorOptions | undefined>()
    expectTypeOf<Parameters<typeof Observer>[0]>().toEqualTypeOf<ObserverOptions | undefined>()
    expectTypeOf<ValidateOptions>().toEqualTypeOf<{ pipes?: Record<string, unknown> }>()
  })

  it('let a wrapper pass them through', () => {
    const InteractionGuard = (options: GuardOptions = {}) => Guard({ types: ['interaction'], ...options })
    const Checked = (schema: StandardSchemaV1, options?: ValidateOptions<Record<never, never>>) => Validate(schema, options)
    void [InteractionGuard, Checked]
  })

  it('let a generic wrapper of @Validate check its pipes against the schema it is given', () => {
    class Trim implements PipeInterface<string, string> {
      transform(value: string) {
        return value.trim()
      }
    }
    const Checked = <S extends StandardSchemaV1, const P extends ValidatePipes<S> = Record<never, never>>(schema: S, options?: ValidateOptions<P>) =>
      Validate(schema, options)
    const named = {} as StandardSchemaV1<unknown, { name: string }>

    Checked(named, { pipes: { name: Trim } })
    // @ts-expect-error `age` is not a key of the schema's output
    Checked(named, { pipes: { age: Trim } })
  })

  it("name @MeoCord's options, so a shared base keeps its stage checks", () => {
    @Guard()
    class Staff implements GuardInterface {
      canActivate() {
        return true
      }
    }
    @Interceptor()
    class Timing implements InterceptorInterface {
      intercept() {
        return undefined
      }
    }
    @Catch()
    class Report implements ExceptionFilter {
      catch() {
        return undefined
      }
    }

    const shared: MeoCordOptions = { controllers: [], clientOptions: { intents: [] }, guards: [Staff], interceptors: [Timing], filters: [Report] }
    @MeoCord(shared)
    class App {}
    @MeoCord({ ...shared, guards: [...(shared.guards ?? []), { provide: Staff }] })
    class Extended {}

    // @ts-expect-error a filter is no guard
    const wrong: MeoCordOptions = { controllers: [], clientOptions: { intents: [] }, guards: [Report] }
    void [App, Extended, wrong]
  })

  it("name an entry point builder's build() result", () => {
    expectTypeOf<PrimaryEntryPointCommandData>().toEqualTypeOf<CommandBuildResult<CommandType.PRIMARY_ENTRY_POINT>>()
  })
})
