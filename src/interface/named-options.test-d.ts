import { describe, expectTypeOf, it } from 'vitest'
import { Guard, Interceptor, Observer, Validate } from '@src/decorator/index.js'
import { type CommandType } from '@src/enum/index.js'
import {
  type CommandBuildResult,
  type GuardOptions,
  type InterceptorOptions,
  type ObserverOptions,
  type PrimaryEntryPointCommandData,
  type StandardSchemaV1,
  type ValidateOptions,
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

  it("name an entry point builder's build() result", () => {
    expectTypeOf<PrimaryEntryPointCommandData>().toEqualTypeOf<CommandBuildResult<CommandType.PRIMARY_ENTRY_POINT>>()
  })
})
