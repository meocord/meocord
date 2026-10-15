import { sharedName } from '@src/util/shared-state.util.js'

/**
 * Where a mock interaction keeps every answer it got, through respond() or discord.js directly, in order, under a key
 * both builds of this meocord version read.
 */
export const RESPONSE_LOG: unique symbol = Symbol.for(sharedName('responseLog'))
