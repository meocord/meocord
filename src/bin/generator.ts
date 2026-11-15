import fs from 'fs'
import path from 'path'
import { Argument, Command } from 'commander'
import { ControllerType } from '@src/enum/controller.enum.js'
import { ControllerGeneratorHelper } from '@src/bin/helper/controller-generator.helper.js'
import { Logger } from '@src/common/index.js'
import { ServiceGeneratorHelper } from '@src/bin/helper/service-generator.helper.js'
import { GuardGeneratorHelper } from '@src/bin/helper/guard-generator.helper.js'
import { InterceptorGeneratorHelper } from '@src/bin/helper/interceptor-generator.helper.js'
import { FilterGeneratorHelper } from '@src/bin/helper/filter-generator.helper.js'
import { PipeGeneratorHelper } from '@src/bin/helper/pipe-generator.helper.js'
import { ObserverGeneratorHelper } from '@src/bin/helper/observer-generator.helper.js'
import wait from '@src/util/wait.util.js'
import { ESLintBudget, formatGeneratedFiles, toClassName, validateAndFormatName } from '@src/util/generator-cli.util.js'
import { type AppList, listingProblemMessage, listInApp } from '@src/bin/app-listing.js'

/**
 * Why a name cannot be a path inside the kind's folder: one that climbs out with `..`, starts at the
 * root, or names a drive. Undefined when it can.
 */
export function namePathProblem(name: string, folder: string): string | undefined {
  const escapes = name.split('/').includes('..') || name.startsWith('/') || /^[a-z]:/i.test(name)
  return escapes
    ? `"${name}" leaves ${folder}. Names are paths inside ${folder}: use admin/ban, not ../ban or an absolute path.`
    : undefined
}

/** What `--skip-app` does, as `generate controller --help` and `generate observer --help` say it. */
const SKIP_APP_HELP = 'Leave src/app.ts alone, and print the lines to add instead'

/** The option a generated autocomplete controller completes, as its command's builder declares it. */
export const AUTOCOMPLETE_QUERY_OPTION =
  ".addStringOption(option => option.setName('query').setDescription('What to search for').setAutocomplete(true))"

/**
 * The class a generated controller or observer exports, the file it is in and the `@MeoCord` list it must be in to
 * take part; undefined for any other kind, whose class is used by naming it in code.
 */
export function appListingFor(
  component: string,
  name: string,
  type?: ControllerType,
  root = process.cwd(),
): { className: string; file: string; list: AppList } | undefined {
  const { parts, kebabCaseName, className } = validateAndFormatName(name)
  if (component === 'controller' && type) {
    return {
      className: `${className}${toClassName(type.replace(/-/g, ' '))}Controller`,
      file: path.join(root, 'src', 'controllers', type, ...parts, `${kebabCaseName}.${type}.controller.ts`),
      list: 'controllers',
    }
  }
  if (component === 'observer') {
    return { className: `${className}Observer`, file: path.join(root, 'src', 'observers', ...parts, `${kebabCaseName}.observer.ts`), list: 'observers' }
  }
  return undefined
}

/**
 * What to do with a generated class for it to take part. A controller or observer does nothing until it is listed in
 * `src/app.ts`, which `generate` does, or says how to, unless `--skip-app` is given; with `listed`, that is handled and
 * the step is only what remains, such as an autocomplete controller's option.
 */
export function nextStepFor(component: string, name: string, type?: ControllerType, listed = false): string | undefined {
  const { className, commandName } = validateAndFormatName(name)
  switch (component) {
    case 'controller': {
      const option = `declare the option it completes on /${commandName}'s builder: ${AUTOCOMPLETE_QUERY_OPTION}`
      // The command it completes already exists, with its own builder, which the generator leaves alone
      if (listed) return type === ControllerType.AUTOCOMPLETE ? `Next: ${option}` : undefined
      const add = `Next: add ${className}${toClassName((type ?? '').replace(/-/g, ' '))}Controller to @MeoCord({ controllers }) in src/app.ts`
      return type === ControllerType.AUTOCOMPLETE ? `${add}, and ${option}` : `${add}.`
    }
    case 'observer':
      return listed ? undefined : `Next: add ${className}Observer to @MeoCord({ observers }) in src/app.ts.`
    case 'guard':
      return `Next: put @UseGuard(${className}Guard) on a handler or controller, or add ${className}Guard to @MeoCord({ guards }) in src/app.ts for every call.`
    case 'interceptor':
      return `Next: put @UseInterceptor(${className}Interceptor) on a handler or controller, or add ${className}Interceptor to @MeoCord({ interceptors }) in src/app.ts for every call.`
    case 'filter':
      return `Next: put @UseFilter(${className}Filter) on a handler or controller, or add ${className}Filter to @MeoCord({ filters }) in src/app.ts for every call.`
    case 'pipe':
      return `Next: use ${className}Pipe in @UsePipe or @Validate's pipes on a handler.`
    case 'service':
      return `Next: inject ${className}Service in a controller's or service's constructor, which binds it, or add it to @MeoCord({ services }) in src/app.ts.`
    default:
      return undefined
  }
}

export class GeneratorCLI {
  private logger: Logger
  private controllerGeneratorHelper: ControllerGeneratorHelper
  private serviceGeneratorHelper: ServiceGeneratorHelper
  private guardGeneratorHelper: GuardGeneratorHelper
  private interceptorGeneratorHelper: InterceptorGeneratorHelper
  private filterGeneratorHelper: FilterGeneratorHelper
  private pipeGeneratorHelper: PipeGeneratorHelper
  private observerGeneratorHelper: ObserverGeneratorHelper

  constructor(private appName: string) {
    this.logger = new Logger(this.appName)
    this.controllerGeneratorHelper = new ControllerGeneratorHelper()
    this.serviceGeneratorHelper = new ServiceGeneratorHelper(this.appName)
    this.guardGeneratorHelper = new GuardGeneratorHelper(this.appName)
    this.interceptorGeneratorHelper = new InterceptorGeneratorHelper(this.appName)
    this.filterGeneratorHelper = new FilterGeneratorHelper(this.appName)
    this.pipeGeneratorHelper = new PipeGeneratorHelper(this.appName)
    this.observerGeneratorHelper = new ObserverGeneratorHelper(this.appName)
  }

  register(program: Command): Command {
    const generatorCommand = program.command('generate').alias('g').description('Generate components')

    generatorCommand
      .command('controller')
      .alias('co')
      .description('Generate a controller component')
      .addArgument(
        // Derived from the enum rather than listed by hand, so a new controller kind
        // cannot be added to the framework and stay unreachable from the CLI.
        new Argument('<type>', 'Type of the controller (e.g., button, context-menu, etc.)').choices(
          Object.values(ControllerType),
        ),
      )
      .addArgument(new Argument('<name>', 'Name of the controller'))
      .option('--message', 'For a context-menu controller: a message context menu command, rather than a user one')
      .option('--skip-app', SKIP_APP_HELP)
      .action(async (type, name, options: { message?: boolean; skipApp?: boolean }) => {
        await this.handleGenerateComponent({
          component: 'controller',
          type: type as ControllerType,
          name,
          message: options.message === true,
          skipApp: options.skipApp === true,
        })
      })

    generatorCommand
      .command('service')
      .alias('s')
      .addArgument(new Argument('<name>', 'Name of the service.'))
      .description('Generate a service component')
      .action(async name => {
        await this.handleGenerateComponent({
          component: 'service',
          name,
        })
      })

    generatorCommand
      .command('guard')
      .alias('gu')
      .addArgument(new Argument('<name>', 'Name of the guard.'))
      .description('Generate a guard component')
      .action(async name => {
        await this.handleGenerateComponent({
          component: 'guard',
          name,
        })
      })

    generatorCommand
      .command('interceptor')
      .alias('i')
      .addArgument(new Argument('<name>', 'Name of the interceptor.'))
      .description('Generate an interceptor component')
      .action(async name => {
        await this.handleGenerateComponent({
          component: 'interceptor',
          name,
        })
      })

    generatorCommand
      .command('filter')
      .alias('f')
      .addArgument(new Argument('<name>', 'Name of the exception filter.'))
      .description('Generate an exception filter component')
      .action(async name => {
        await this.handleGenerateComponent({
          component: 'filter',
          name,
        })
      })

    generatorCommand
      .command('pipe')
      .alias('pi')
      .addArgument(new Argument('<name>', 'Name of the pipe.'))
      .description('Generate a pipe component')
      .action(async name => {
        await this.handleGenerateComponent({
          component: 'pipe',
          name,
        })
      })

    generatorCommand
      .command('observer')
      .alias('ob')
      .addArgument(new Argument('<name>', 'Name of the observer.'))
      .description('Generate a dispatch observer component')
      .option('--skip-app', SKIP_APP_HELP)
      .action(async (name, options: { skipApp?: boolean }) => {
        await this.handleGenerateComponent({
          component: 'observer',
          name,
          skipApp: options.skipApp === true,
        })
      })

    return program
  }

  private async handleGenerateComponent(args: {
    component: string
    name: string
    type?: ControllerType
    message?: boolean
    skipApp?: boolean
  }): Promise<void> {
    const { component, type } = args
    let { name } = args

    if (!name) {
      this.logger.error('Name is required')
      await wait(100)
      process.exit(1)
    }

    // Generators write relative to the working directory, so outside a project they would scatter files.
    if (!fs.existsSync(path.join(process.cwd(), 'package.json'))) {
      this.logger.error("No package.json here: run meocord generate from your project's root.")
      await wait(100)
      process.exit(1)
    }

    // Windows users may separate folders with a backslash; the generators split on forward slashes.
    if (process.platform === 'win32') name = name.replace(/\\/g, '/')

    const problem = namePathProblem(name, component === 'controller' ? `src/controllers/${type}/` : `src/${component}s/`)
    if (problem) {
      this.logger.error(problem)
      await wait(100)
      process.exit(1)
    }

    // The files written, which one run of the project's ESLint formats once all are
    let written: string[] = []
    switch (component) {
      case 'controller':
        if (!type) {
          this.logger.error('Type is required for controllers')
          await wait(100)
          process.exit(1)
        }
        if (args.message && type !== ControllerType.CONTEXT_MENU) {
          this.logger.error('--message applies to context-menu controllers only.')
          await wait(100)
          process.exit(1)
        }
        written = await this.handleGenerateController({ name, type, message: args.message === true })
        break

      case 'service':
        written = this.serviceGeneratorHelper.generateService(name)
        break

      case 'guard':
        written = this.guardGeneratorHelper.generateGuard(name)
        break

      case 'interceptor':
        written = this.interceptorGeneratorHelper.generateInterceptor(name)
        break

      case 'filter':
        written = this.filterGeneratorHelper.generateFilter(name)
        break

      case 'pipe':
        written = this.pipeGeneratorHelper.generatePipe(name)
        break

      case 'observer':
        written = this.observerGeneratorHelper.generateObserver(name)
        break

      default:
        this.logger.error(`Unsupported component type: ${component}`)
        await wait(100)
        process.exit(1)
    }

    // One time limit for every ESLint run: once one is stopped, src/app.ts's check is not started and says so
    const eslintBudget = new ESLintBudget()
    await formatGeneratedFiles(written, eslintBudget)

    // A file that failed to write sets the exit code; there is no next step then
    if (process.exitCode) return
    // After the formatting, which src/app.ts is kept out of: the user's own file changes only by the inserted lines
    const listing = args.skipApp ? undefined : appListingFor(component, name, type)
    if (listing) {
      const result = await listInApp(process.cwd(), listing.file, listing.className, listing.list, eslintBudget)
      // A refusal prints the lines to add itself, so the next step leaves them out either way
      if ('problem' in result) {
        this.logger.warn(listingProblemMessage(process.cwd(), listing.file, listing.className, listing.list, result.problem))
      } else {
        if ('listed' in result) this.logger.log(`${listing.className} is already in src/app.ts.`)
        else if (result.unchecked) this.logger.warn(`Added ${listing.className} to src/app.ts, not checked with ESLint: ${result.unchecked}.`)
        else this.logger.log(`Added ${listing.className} to src/app.ts.`)
      }
    }
    const next = nextStepFor(component, name, type, listing !== undefined)
    if (next) this.logger.log(next)
  }

  private async handleGenerateController(args: { name: string; type: ControllerType; message: boolean }): Promise<string[]> {
    try {
      return this.controllerGeneratorHelper.generateController({ controllerName: args.name }, args.type, { message: args.message })
    } catch (error) {
      this.logger.error(`Error generating controller: ${error instanceof Error ? error.message : String(error)}`)
      await wait(100)
      process.exit(1)
    }
  }
}
