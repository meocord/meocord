// Timeouts the specs share; no entry point imports this file, so it never ships

/**
 * A setup hook's budget when it compiles discord.js and the framework, or reads discord.js's typings, on a file's first
 * run: about 2 s on a healthy runner, several times that on a slow one.
 */
export const WARM_UP_TIMEOUT_MS = 30_000

/**
 * A child process's bound for starting cold and running a short script, as `spawnSync`'s timeout or a kill after it. The
 * child compiles the sources it imports, discord.js among them for most of this repository's files, as a setup hook does
 * on a file's first run, so it takes the same budget: over 5 s on a slow Windows runner.
 */
export const CHILD_PROCESS_TIMEOUT_MS = WARM_UP_TIMEOUT_MS

/** How long a case outlasts its child's bound: room for the case to report a child killed at the bound. */
export const CHILD_PROCESS_CASE_MARGIN_MS = 5_000

/** The budget of a case that runs such a child: past the child's own, so a hung child fails with its own message. */
export const CHILD_PROCESS_CASE_TIMEOUT_MS = CHILD_PROCESS_TIMEOUT_MS + CHILD_PROCESS_CASE_MARGIN_MS
