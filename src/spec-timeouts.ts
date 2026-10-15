// Timeouts the specs share; no entry point imports this file, so it never ships

/**
 * A setup hook's budget when it compiles discord.js and the framework, or reads discord.js's typings, on a file's first
 * run: about 2 s on a healthy runner, several times that on a slow one.
 */
export const WARM_UP_TIMEOUT_MS = 30_000
