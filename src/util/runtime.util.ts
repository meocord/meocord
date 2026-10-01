/**
 * Environment variable that pins the binary the application is spawned with.
 *
 * An escape hatch for pinning a specific install, or for running the application under a
 * different runtime than the CLI to compare behaviour. Unset is the normal case.
 */
export const RUNTIME_OVERRIDE_ENV = 'MEOCORD_RUNTIME'

/** A command to spawn, split so it can be passed without a shell. */
export interface RuntimeCommand {
  command: string
  args: string[]
}

/**
 * Runners that are themselves JavaScript runtimes. npm, pnpm and yarn set `npm_execpath` to a `.js`
 * file that cannot run the bundle, so only runners verified against their real environment are listed.
 */
const RUNTIME_RUNNERS: ReadonlySet<string> = new Set(['bun'])

/**
 * The runtime that launched the CLI, when the CLI itself runs on node: `bun run` honours the bin's
 * node shebang, but sets `npm_config_user_agent` and `npm_execpath` to bun.
 * @returns The launcher's binary, or undefined when it cannot run the application.
 */
function launcherRuntime(env: NodeJS.ProcessEnv): string | undefined {
  const runner = env.npm_config_user_agent?.split('/')[0]
  const launcher = env.npm_execpath?.trim()

  if (runner === undefined || !launcher) return undefined

  // npm keeps a user agent it inherits but sets its own execpath, so under `npm run` started from a
  // bun script the two disagree; the execpath is trusted only when it is the runner's own binary.
  return RUNTIME_RUNNERS.has(runner) && isBun(launcher) ? launcher : undefined
}

/**
 * The binary to spawn the application with, following the runtime the user chose: an override,
 * then the runner that launched the CLI, then the binary executing it.
 * @param execPath - Binary executing the CLI, i.e. `process.execPath`.
 */
export function resolveRuntime(env: NodeJS.ProcessEnv, execPath: string): string {
  const override = env[RUNTIME_OVERRIDE_ENV]?.trim()

  // An override of only whitespace would spawn '' and fail with an ENOENT naming nothing,
  // so it is treated as absent rather than passed through.
  if (override) return override

  return launcherRuntime(env) ?? execPath
}

/**
 * The command that runs the built entry file with `runtime`: with `--no-install` for bun, and with
 * `--enable-source-maps` for node when `sourceMaps` is set, so its stack traces name the source.
 */
export function buildAppCommand(
  runtime: string,
  mainJsPath: string,
  { sourceMaps = false }: { sourceMaps?: boolean } = {},
): RuntimeCommand {
  // Without node_modules in reach, bun installs a missing package the moment something imports it;
  // `--no-install` keeps a bundled bot from downloading packages such as `zlib-sync` at startup.
  if (isBun(runtime)) return { command: runtime, args: ['--no-install', mainJsPath] }
  // Bun maps nothing, so there the bundle maps its own stacks; see build/stack-remap.ts
  if (sourceMaps && isNode(runtime)) return { command: runtime, args: ['--enable-source-maps', mainJsPath] }
  return { command: runtime, args: [mainJsPath] }
}

/**
 * Whether a runtime binary is bun, by the name it was resolved to.
 *
 * Split on both separators rather than through path.basename, which only knows the separator
 * of the platform it runs on.
 */
function isBun(runtime: string): boolean {
  return /^bun(\.exe)?$/i.test(runtime.split(/[\\/]/).pop() ?? '')
}

/** Whether a runtime binary is node, by the name it was resolved to, as {@link isBun} decides. */
function isNode(runtime: string): boolean {
  return /^node(\.exe)?$/i.test(runtime.split(/[\\/]/).pop() ?? '')
}

