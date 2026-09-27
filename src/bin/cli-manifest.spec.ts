import { Argument, Command, Option } from 'commander'
import { cliManifest, type CliManifestCommand } from '@src/bin/cli-manifest.js'
import { MeoCordCLI } from '@src/bin/meocord.js'

// Every command path with its aliases, arguments and options, read from commander's own arrays
function liveSignatures(command: Command, parents: string[] = []): string[] {
  return command.commands.flatMap(child => {
    const path = [...parents, child.name()]
    const signature = [
      path.join(' '),
      `aliases=${child.aliases().join(',')}`,
      `args=${child.registeredArguments.map(argument => argument.name()).join(',')}`,
      `options=${child.options.map(option => option.flags).join(',')}`,
    ].join(' | ')
    return [signature, ...liveSignatures(child, path)]
  })
}

function manifestSignatures(commands: CliManifestCommand[]): string[] {
  return commands.flatMap(command => {
    const signature = [
      command.path.join(' '),
      `aliases=${command.aliases.join(',')}`,
      `args=${command.arguments.map(argument => argument.name).join(',')}`,
      `options=${command.options.map(option => option.flags).join(',')}`,
    ].join(' | ')
    return [signature, ...manifestSignatures(command.commands)]
  })
}

describe('cliManifest', () => {
  it('describes every command, alias, argument and option of the program the CLI runs', () => {
    const program = new MeoCordCLI().program()
    const manifest = cliManifest(program, '1.2.3')

    expect(manifestSignatures(manifest.commands)).toEqual(liveSignatures(program))
    expect(manifest.options.map(option => option.flags)).toEqual(program.options.map(option => option.flags))
    expect(manifest).toMatchObject({ schemaVersion: 1, meocordVersion: '1.2.3', name: 'meocord' })
  })

  it('gives the same JSON for the same program, with nothing JSON would drop', () => {
    const first = cliManifest(new MeoCordCLI().program(), '1.2.3')
    const second = cliManifest(new MeoCordCLI().program(), '1.2.3')

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  it('keeps the declared order, and leaves out hidden entries and the implicit help', () => {
    const program = new Command('tool').version('0.0.0')
    program.command('zeta')
    program.command('secret', { hidden: true })
    program.command('alpha').option('--zed').addOption(new Option('--internal').hideHelp()).option('--able')

    const manifest = cliManifest(program, '0.0.0')

    expect(manifest.options.map(option => option.flags)).toEqual(['-V, --version'])
    expect(manifest.commands.map(command => command.name)).toEqual(['zeta', 'alpha'])
    expect(manifest.commands[1].options.map(option => option.long)).toEqual(['--zed', '--able'])
  })

  it('records what each argument and option declares', () => {
    const program = new Command('tool')
    program
      .command('deploy')
      .alias('d')
      .summary('Deploys')
      .description('Deploys the bot to a target')
      .addArgument(new Argument('<target>', 'Where to').choices(['staging', 'production']))
      .addArgument(new Argument('[files...]', 'What to send').default(['dist'], 'the build'))
      .requiredOption('-r, --region <name>', 'Region')
      .addOption(new Option('--token <value>', 'Token').env('DEPLOY_TOKEN'))
      .option('--no-cache', 'Skip the cache')
      .addHelpText('before', 'Read first')
      .addHelpText('after', () => 'Example: tool deploy staging')

    const [deploy] = cliManifest(program, '0.0.0').commands

    expect(deploy).toMatchObject({
      path: ['deploy'],
      aliases: ['d'],
      summary: 'Deploys',
      description: 'Deploys the bot to a target',
      helpText: { before: 'Read first', after: 'Example: tool deploy staging' },
      commands: [],
    })
    expect(deploy.arguments).toEqual([
      {
        name: 'target',
        description: 'Where to',
        required: true,
        variadic: false,
        default: null,
        defaultDescription: null,
        choices: ['staging', 'production'],
      },
      {
        name: 'files',
        description: 'What to send',
        required: false,
        variadic: true,
        default: ['dist'],
        defaultDescription: 'the build',
        choices: null,
      },
    ])
    expect(deploy.options).toEqual([
      {
        flags: '-r, --region <name>',
        short: '-r',
        long: '--region',
        description: 'Region',
        value: { name: 'name', required: true, variadic: false },
        mandatory: true,
        default: null,
        defaultDescription: null,
        choices: null,
        env: null,
        negate: false,
      },
      expect.objectContaining({ long: '--token', env: 'DEPLOY_TOKEN', mandatory: false }),
      expect.objectContaining({ long: '--no-cache', value: null, negate: true }),
    ])
  })

  it('writes null for text a command leaves empty', () => {
    const program = new Command('tool')
    program.command('bare')

    const [bare] = cliManifest(program, '0.0.0').commands

    expect(bare).toMatchObject({
      summary: null,
      description: null,
      helpText: { before: null, after: null },
      arguments: [],
      options: [],
    })
  })
})
