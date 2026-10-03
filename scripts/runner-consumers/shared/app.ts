import 'reflect-metadata'
import { type ButtonInteraction } from 'discord.js'
import { respond } from 'meocord/common'
import { Command, Controller, Service } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'

@Service()
export class Greeting {
  text(): string {
    return 'hello'
  }
}

@Controller()
export class Greeter {
  constructor(private readonly greeting: Greeting) {}

  @Command('greet', CommandType.BUTTON)
  async greet(interaction: ButtonInteraction) {
    await respond(interaction).send({ content: this.greeting.text() })
  }
}
