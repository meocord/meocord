// @ts-check
/**
 * Mutation testing for the framework's core, run by hand with `bun run test:mutation [module]`; it is
 * not a CI check. Each module is mutated on its own, and every mutant faces the framework's whole
 * runtime suite (vitest.mutation.config.ts). Reports land in reports/mutation/.
 *
 * The vitest runner runs only the tests that cover each mutant. On Vitest 5 it reports covered mutants
 * as survived (stryker-mutator/stryker-js#6210), since Vitest 5 joins test names with ' > '.
 * patches/ carries that fix from stryker-mutator/stryker-js#6220; drop the patch once #6220 or #6214 ships.
 * A static mutant (a decorator body, a top-level constant) runs after a reload against the whole
 * suite, most of a module's run time. `ignoreStatic` stays off: it runs a static mutant that tests also
 * cover against those tests alone, without the reload, so the mutated module-level code never runs and
 * the mutant reads as survived or timed out.
 *
 * Runs are incremental: each module keeps its results in reports/mutation/<module>.incremental.json, and
 * a run tests only the mutants whose source or covering tests changed. Changes elsewhere (a module the
 * code imports, a dependency, the setup) go unseen; `bun run test:mutation -- --force` reruns everything.
 */

/** Each module: the files it mutates. */
export const modules = {
  'guard-runner': {
    mutate: ['src/core/guard-runner.ts'],
  },
  'filter-runner': {
    mutate: ['src/core/filter-runner.ts'],
  },
  'interceptor-runner': {
    mutate: ['src/core/interceptor-runner.ts'],
  },
  'handler-pipeline': {
    mutate: ['src/core/handler-pipeline.ts'],
  },
  'input-runner': {
    mutate: ['src/core/input-runner.ts'],
  },
  response: {
    mutate: ['src/common/response/*.ts', '!src/common/response/*.spec.ts', '!src/common/response/*.test-d.ts'],
  },
  defer: {
    mutate: ['src/core/defer.ts', 'src/decorator/defer.decorator.ts'],
  },
  'command-registration': {
    mutate: ['src/core/command-registration.ts'],
  },
  cooldown: {
    mutate: ['src/core/cooldown-runner.ts', 'src/common/cooldown-store.ts', 'src/decorator/cooldown.decorator.ts'],
  },
  translator: {
    mutate: ['src/common/translator.ts'],
  },
}

const name = process.env.MUTATION_MODULE ?? 'translator'
const module = modules[/** @type {keyof typeof modules} */ (name)]
if (!module) throw new Error(`Unknown mutation module "${name}"; one of: ${Object.keys(modules).join(', ')}.`)

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  coverageAnalysis: 'perTest',
  // Concurrency stays at Stryker's default, one test runner per core but one; the vitest runner gives
  // each a single Vitest worker, so that is the whole parallelism.
  timeoutMS: 30_000,
  incremental: true,
  incrementalFile: `reports/mutation/${name}.incremental.json`,
  mutate: module.mutate,
  reporters: ['clear-text', 'progress-append-only', 'html', 'json'],
  htmlReporter: { fileName: `reports/mutation/${name}.html` },
  jsonReporter: { fileName: `reports/mutation/${name}.json` },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
}
