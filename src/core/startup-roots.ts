import { missingTranslatorError, Translator } from '@src/common/translator.js'
import { type GuardEntry, injectedTokens, isGuardWithParams } from '@src/core/guard-runner.js'
import { classDecorators, type GlobalStages, handlerStageClasses } from '@src/core/handler-pipeline.js'
import { assertTypedParameters, type ProviderMap, reachableClasses } from '@src/core/providers.js'
import { themeResolverClass, type ThemeResolverClass } from '@src/core/theme-resolvers.js'
import { type ThemeResolvers } from '@src/interface/index.js'
import { META } from '@src/util/metadata-keys.js'
import { refuse } from '@src/util/refusal.util.js'

type AnyClass = new (...args: any[]) => unknown

/** Every place an app names a class MeoCord makes from its container. */
export interface StartupRoots {
  controllers: readonly unknown[]
  services: readonly unknown[]
  providers: ProviderMap
  stages?: GlobalStages
  presenter?: unknown
  cooldownStore?: unknown
  themeFor?: ThemeResolvers | ThemeResolverClass
  observers: readonly unknown[]
  /** Stage classes a test's override stands in for, which are never made. */
  stubs?: readonly unknown[]
}

/** The classes an app runs, with the decorator each controller and stage class takes. */
export interface StartupClasses {
  classes: AnyClass[]
  decorators: Map<unknown, string>
}

/** The guards `@UseGuard` puts on a class's methods, handlers or not, which a direct call runs too. */
function methodGuards(cls: AnyClass): unknown[] {
  const guards: unknown[] = []
  for (let prototype = cls.prototype as object | null; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const entries = Reflect.getOwnMetadata(META.methodGuards, prototype, name) as GuardEntry[] | undefined
      for (const entry of entries ?? []) guards.push(isGuardWithParams(entry) ? entry.provide : entry)
    }
  }
  return guards
}

/**
 * Every class MeoCord makes for an app, found before anything is bound: its controllers, services, providers' classes,
 * global and handler stages, presenter, cooldown store, themeFor class and observers, each guard any of their methods
 * declares, and what each of them injects. The factory and the testing module both build from this one list, so every
 * startup check sees every class.
 */
export function startupClasses(roots: StartupRoots): StartupClasses {
  const stubs = new Set(roots.stubs)
  const decorators = classDecorators(roots.controllers as object[], roots.stages)
  for (const stub of stubs) decorators.delete(stub)
  const themeResolver = themeResolverClass(roots.themeFor)
  const named = [
    ...roots.controllers,
    ...roots.services,
    ...roots.observers,
    ...[roots.presenter, roots.cooldownStore, themeResolver].filter(cls => cls !== undefined),
  ]
  // A service's handler stages and any method's guards can sit on a class only another stage reaches, so it repeats
  // until none is new
  for (;;) {
    const classes = reachableClasses([...named, ...decorators.keys()], roots.providers)
    const found = classes
      .flatMap(cls => [...handlerStageClasses(cls), ...methodGuards(cls).map(guard => [guard, '@Guard()'] as [unknown, string])])
      .filter(([stage]) => !decorators.has(stage) && !stubs.has(stage))
    if (found.length === 0) return { classes, decorators }
    for (const [stage, decorator] of found) decorators.set(stage, decorator)
  }
}

/** Runs the startup checks over every class an app runs, so a class that cannot be made is refused by name now. */
export function assertStartupClasses({ classes, decorators }: StartupClasses, { translator }: { translator: boolean }): void {
  assertTypedParameters(classes, decorators)
  if (translator) return
  const needsOne = classes.find(cls => injectedTokens(cls).includes(Translator))
  if (needsOne) throw refuse(missingTranslatorError(needsOne))
}
