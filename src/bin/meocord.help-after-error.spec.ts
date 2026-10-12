import { type Command } from 'commander'
import { MeoCordCLI } from '@src/bin/meocord.js'

// Every command with its path, the root's included
function commandsOf(command: Command, path: string[] = []): [string[], Command][] {
  return [[path, command], ...command.commands.flatMap(child => commandsOf(child, [...path, child.name()]))]
}

describe('help after an error', () => {
  const program = new MeoCordCLI().program()
  const commands = commandsOf(program)

  it.each(commands.map(([path, command]) => [path.join(' ') || '(root)', path, command] as const))(
    '%s shows its own help after an unknown option',
    (_, path, command) => {
      let written = ''
      for (const [, each] of commands) each.exitOverride().configureOutput({ writeErr: text => void (written += text), writeOut: () => {} })

      expect(() => program.parse(['node', 'meocord', ...path, '--no-such-option'])).toThrow()
      expect(written).toContain("error: unknown option '--no-such-option'")
      expect(written).toContain(`\n${[program.name(), ...path].join(' ')}`)
      expect(written).toContain(command.description())
    },
  )
})
