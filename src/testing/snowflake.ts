import { shared } from '@src/util/shared-state.util.js'

/**
 * The id of the bot every mock client is logged in as, so a test can mention it. Fixed, and below the
 * ids other mocks take, so it is the same on every run and in any test order, and no mock shares it.
 */
export const MOCK_BOT_ID = '1300000000000000000'

/**
 * The last id a mock was given, for both builds of this meocord version; ids count up from a real snowflake, so each
 * mock's is its own.
 */
const ids = shared('mockIds', () => ({ last: 1_400_000_000_000_000_000n }))

/** A snowflake-shaped id nothing else a mock holds in this run has, for a mock or the media it resolves. */
export const nextSnowflake = (): string => String(++ids.last)
