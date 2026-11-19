// Garbage-collection checks the specs share; no entry point imports this file, so it never ships
import { queryObjects } from 'node:v8'

/**
 * The most objects of one kind a spec may find alive at once after making many of them without yielding. V8's
 * optimizing compilers can hold a few for a moment, released by the next turn; the most seen at once in 8000 repeats
 * was 1. A pile-up reads every object made, so a spec makes many times this many: the bound tells growth with the count
 * from a constant, not that 20 kept objects are acceptable. That an object is collected at all is checked per object,
 * with a WeakRef and collectGarbage().
 */
export const PILE_UP_BOUND = 20

/**
 * Starts counting the live objects of a class. The function it returns gives how many more are alive than when the
 * count started; V8 collects garbage before each count, so it reads only what something still holds. It creates no
 * WeakRef, which would keep its object alive until the job ends.
 */
export function countGrowth(type: Parameters<typeof queryObjects>[0]): () => number {
  const live = () => queryObjects(type, { format: 'count' })
  const before = live()
  return () => live() - before
}

/** Lets the job end, collects garbage (queryObjects does first), then lets finalization callbacks run. */
export async function collectGarbage(): Promise<void> {
  const turn = () => new Promise(resolve => setTimeout(resolve, 0))
  await turn()
  queryObjects(Object, { format: 'count' })
  for (let i = 0; i < 3; i++) await turn()
}
