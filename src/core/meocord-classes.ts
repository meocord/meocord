import { CooldownStore } from '@src/common/cooldown-store.js'
import {
  CooldownError,
  CooldownStoreError,
  GuardDeniedError,
  MessageUsageError,
  UserError,
  ValidationError,
} from '@src/common/errors.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { Logger } from '@src/common/logger.js'
import { RedisCooldownStore } from '@src/common/redis-cooldown-store.js'
import { Translator } from '@src/common/translator.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { ShardContext } from '@src/core/shard-context.js'
import { ThemeCache } from '@src/core/theme-resolvers.js'

/** The classes MeoCord binds itself, which an app's class may inject but MeoCord makes, never from their decorators. */
export const meocordClasses = (): readonly unknown[] => [CooldownStore, ExecutionContext, HandlerRegistry, ShardContext, ThemeCache, Translator]

const created = (cls: { name: string }) => `create it with \`new ${cls.name}(…)\``

/** What to do in place of injecting each of MeoCord's classes an app makes itself; the testing module adds its own. */
const advice = new Map<unknown, string>([
  [Logger, created(Logger)],
  ...[CooldownError, CooldownStoreError, GuardDeniedError, MessageUsageError, UserError, ValidationError].map(
    cls => [cls, `${created(cls)} where it is thrown`] as const,
  ),
  [RedisCooldownStore, 'give @MeoCord({ cooldownStore }) RedisCooldownStore.using(…), and inject CooldownStore for the app\'s store'],
])

/** What to do in place of injecting `cls`, one of MeoCord's classes an app makes itself, or `undefined`. */
export function meocordClassAdvice(cls: unknown): string | undefined {
  return advice.get(cls)
}

/** Adds what to do in place of injecting `cls`, for a class of MeoCord's that `meocord/core` does not load. */
export function adviseInPlaceOfInjecting(cls: unknown, instead: string): void {
  advice.set(cls, instead)
}
