import { ButtonInteraction } from 'discord.js'
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
