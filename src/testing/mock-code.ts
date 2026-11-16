import { strictMocks } from '@src/testing/strict-mocks.js'
import { readQuietly } from '@src/util/quiet-reads.util.js'

/**
 * Runs `run`, synchronous, as the mock's own code, or discord.js's on a mock: what it reads of a key the mock's class
 * lacks is not the app's or the test's, so it does not warn. Under strict mocks, which never warn of such a read, it
 * just runs it.
 */
export function asMockCode<T>(run: () => T): T {
  return strictMocks() ? run() : readQuietly(run)
}
