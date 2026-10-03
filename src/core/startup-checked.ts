/** For each container MeoCord builds an app into, the classes its startup checks saw. */
const checked = new WeakMap<object, ReadonlySet<unknown>>()

/** Records the classes the startup checks saw for `container`: every class MeoCord binds into it must be one of them. */
export function markStartupChecked(container: object, classes: Iterable<unknown>): void {
  checked.set(container, new Set(classes))
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
