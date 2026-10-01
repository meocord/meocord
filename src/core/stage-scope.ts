import 'reflect-metadata'
import { type ExecutionContextType } from '@src/common/execution-context.js'
import { refuse } from '@src/util/refusal.util.js'
import { describeValue, isConstructor } from '@src/util/value.util.js'

/** The context types a guard, interceptor or observer class declared it runs for, such as `@Guard({ types })`. */
const STAGE_TYPES = Symbol('stage_types')

/** A stage entry as the pipeline lists it: a class, or `{ provide, params? }`. */
type StageEntry = (new (...args: any[]) => unknown) | { provide: new (...args: any[]) => unknown }

/**
 * Records the context types a stage class runs for; without them it runs for every type. A list that
 * can match no call is refused: an empty one, or autocomplete alone for an interceptor.
 */
export function defineStageTypes(
  cls: { name: string },
  types: readonly ExecutionContextType[] | undefined,
  decorator: 'Guard' | 'Interceptor' | 'Observer',
): void {
  if (!types) return
  if (types.length === 0) {
    throw refuse(new Error(
      `${cls.name}: @${decorator}({ types: [] }) lists no types, so it would never run. List the types it ` +
        `runs for, or leave types out to run for every type.`,
    ))
  }
  // Interceptors never run for autocomplete, which must answer within three seconds
  if (decorator === 'Interceptor' && types.every(type => type === 'autocomplete')) {
    throw refuse(new Error(
      `${cls.name}: @Interceptor({ types: ['autocomplete'] }) can never run: interceptors skip autocomplete ` +
        `handlers. List the types it should run for instead.`,
    ))
  }
  Reflect.defineMetadata(STAGE_TYPES, [...types], cls)
}

/** Why an entry is not a class or `{ provide: Class, params? }`, or undefined when it is one. */
function malformation(entry: unknown): string | undefined {
  if (isConstructor(entry)) return undefined
  if (typeof entry !== 'object' || entry === null) return `${describeValue(entry)} is not a class`
  const { provide, params } = entry as { provide?: unknown; params?: unknown }
  if (!isConstructor(provide)) return '{ provide } does not name a class'
  if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
    return `the params of ${provide.name || 'an entry'} are not an object`
  }
  return undefined
}

/**
 * Refuses a stage entry that is neither a class nor `{ provide: Class, params? }` when the decorator
 * applies, rather than when a call first resolves it.
 *
 * @param decorator - What was given the entries, such as `@UseGuard` or `@MeoCord({ guards })`.
 * @param kind - What each entry must be: `'guard'`, `'interceptor'`, `'filter'` or `'pipe'`.
 * @param where - The class, or `Class.method`, the decorator applies to.
 */
export function assertStageEntries(
  decorator: string,
  kind: 'guard' | 'interceptor' | 'filter' | 'pipe',
  where: string,
  entries: readonly unknown[],
): void {
  for (const entry of entries) {
    const reason = malformation(entry)
    if (!reason) continue
    const Kind = `${kind[0].toUpperCase()}${kind.slice(1)}`
    throw refuse(new Error(
      `${where}: ${decorator}: ${reason}. Give ${kind === 'interceptor' ? 'an' : 'a'} ${kind} class, or ` +
        `{ provide: ${Kind}Class, params? } with params an object.`,
    ))
  }
}

/** The class of a stage entry. */
export function stageClass(entry: StageEntry): new (...args: any[]) => unknown {
  return isConstructor(entry) ? (entry as new (...args: any[]) => unknown) : entry.provide
}

/** The context types a stage declared, or `undefined` when it runs for every type. */
export function stageTypes(entry: StageEntry): readonly ExecutionContextType[] | undefined {
  return Reflect.getMetadata(STAGE_TYPES, stageClass(entry)) as ExecutionContextType[] | undefined
}

/** Whether a stage runs for a call of `type`. */
export function appliesTo(entry: StageEntry, type: ExecutionContextType): boolean {
  return stageTypes(entry)?.includes(type) ?? true
}
