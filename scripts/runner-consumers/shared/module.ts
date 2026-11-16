import { ButtonInteraction } from 'discord.js'
import { Logger } from 'meocord/common'
import { createMockInteraction, MeoCordTestingModule } from 'meocord/testing'
import { Greeter, Greeting } from './app.js'

/** Clicks the greet button with the runner's own mock function standing in for the service's `text`. */
export async function clickGreet(text: () => string) {
  const module = MeoCordTestingModule.create({ controllers: [Greeter] })
    .overrideProvider(Greeting)
    .useValue({ text })
    .compile()
  const click = createMockInteraction(ButtonInteraction, { customId: 'greet' })
  const outcome = await module.dispatch(click)
  return { click, outcome }
}

/** The start of meocord's warning about a key a mock's class lacks, naming the class and the key. */
const ABSENT_KEY_WARNING = /^A mock (\w+)'s (\w+) reads a placeholder here; discord\.js/

/**
 * The keys meocord warns about, in default mode, as a mock's class lacking them, while a click is dispatched, the test
 * reads keys its class has, and then reads one it lacks on purpose. The warning is once a run, so it names that key
 * only if nothing before it, in this case or an earlier one, read a key a class lacks.
 */
export async function absentKeyWarnings(): Promise<string[]> {
  const warned: string[] = []
  const warn = Logger.prototype.warn
  Logger.prototype.warn = function (...args: unknown[]) {
    warned.push(String(args[0]))
  }
  try {
    const { click } = await clickGreet(() => 'read')
    void [click.customId, click.user.id, click.guildId, click.message, click.replied]
    void (click as unknown as Record<string, unknown>).notAThing
  } finally {
    Logger.prototype.warn = warn
  }
  return warned.flatMap(text => {
    const named = ABSENT_KEY_WARNING.exec(text)
    return named ? [`${named[1]}.${named[2]}`] : []
  })
}
