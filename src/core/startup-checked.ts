/** For each container MeoCord builds an app into, the classes its startup checks saw. */
const checked = new WeakMap<object, Set<unknown>>()
/** For each such container, how it checks a guard a call meets that its startup checks never saw. */
const lateChecks = new WeakMap<object, (guard: unknown) => void>()

/**
 * Records the classes the startup checks saw for `container`: every class MeoCord binds into it as the app is created
 * must be one of them. `checkLate` checks a guard first met at a call, on an instance the app made itself.
 */
export function markStartupChecked(container: object, classes: Iterable<unknown>, checkLate: (guard: unknown) => void): void {
  checked.set(container, new Set(classes))
  lateChecks.set(container, checkLate)
}

/**
 * Checks, once, a guard a direct call meets that the startup checks never saw, such as one on a method of a subclass
 * the app makes itself: the instances it makes are an open set, so these are checked as they are met.
 */
export function checkOnFirstUse(container: object, guard: unknown): void {
  const seen = checked.get(container)
  if (!seen || seen.has(guard)) return
  lateChecks.get(container)?.(guard)
  seen.add(guard)
}

/**
 * Throws when MeoCord binds into a checked container a class its startup checks never saw, which means a place the app
 * names classes in is missing from the list the checks walk.
 */
export function assertStartupChecked(container: object, cls: unknown): void {
  const seen = checked.get(container)
  if (seen && !seen.has(cls)) {
    throw new Error(`${(cls as { name?: string }).name || 'A class'}: MeoCord binds it without checking it as the app is created. This is a bug in MeoCord; please report it.`)
  }
}
