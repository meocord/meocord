// Garbage-collection checks the specs share; no entry point imports this file, so it never ships
import * as v8 from 'node:v8'

/**
 * The most objects of one kind a spec may find alive at once after making many of them without yielding. V8's
 * optimizing compilers can hold a few for a moment, released by the next turn; the most seen at once in 8000 repeats
 * was 1. A pile-up reads every object made, so a spec makes many times this many: the bound tells growth with the count
 * from a constant, not that 20 kept objects are acceptable. That an object is collected at all is checked per object,
 * with a WeakRef and collectGarbage().
 */
export const PILE_UP_BOUND = 20

/** The heap API Bun gives in place of `queryObjects`, which JavaScriptCore has no counterpart of. */
interface BunHeap {
  gc(sync: boolean): void
  generateHeapSnapshot(): { nodes: number[]; nodeClassNames: string[] }
}

const bun = (globalThis as { Bun?: BunHeap }).Bun

/**
 * Whether an object a test let go of may stay alive through a collection: JavaScriptCore scans the native stack
 * conservatively, so a stale slot can keep one reachable, more or less often as unrelated code moves. A row that
 * asserts a dropped object was collected runs where this is false; a bound on how many stay alive runs everywhere.
 */
export const keepsDroppedObjects = bun !== undefined

/** Entries per node in a Bun heap snapshot's flat `nodes` array, and where the class-name index sits in each. */
const SNAPSHOT_NODE_FIELDS = 4
const SNAPSHOT_CLASS_NAME_FIELD = 2

type Countable = Parameters<typeof v8.queryObjects>[0]

/**
 * Live instances of `type`, after a full collection. Under Bun it counts a heap snapshot's nodes by class name, so
 * another class of the same name counts too and a subclass of another name does not; one count takes about half a
 * second there.
 */
function liveCount(type: Countable): number {
  if (!bun) return v8.queryObjects(type, { format: 'count' })
  bun.gc(true)
  const { nodes, nodeClassNames } = bun.generateHeapSnapshot()
  const name = nodeClassNames.indexOf(type.name)
  let count = 0
  if (name >= 0) for (let i = SNAPSHOT_CLASS_NAME_FIELD; i < nodes.length; i += SNAPSHOT_NODE_FIELDS) if (nodes[i] === name) count++
  return count
}

/**
 * Starts counting the live objects of a class. The function it returns gives how many more are alive than when the
 * count started; garbage is collected before each count, so it reads only what something still holds. It creates no
 * WeakRef, which would keep its object alive until the job ends.
 */
export function countGrowth(type: Countable): () => number {
  const before = liveCount(type)
  return () => liveCount(type) - before
}

/** Lets the job end, collects garbage, then lets finalization callbacks run. */
export async function collectGarbage(): Promise<void> {
  const turn = () => new Promise(resolve => setTimeout(resolve, 0))
  await turn()
  if (bun) bun.gc(true)
  else v8.queryObjects(Object, { format: 'count' })
  for (let i = 0; i < 3; i++) await turn()
}
