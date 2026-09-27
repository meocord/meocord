import { describe, expectTypeOf, it } from 'vitest'
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  type ContextMenuCommandType,
  type MessageContextMenuCommandInteraction,
  PermissionFlagsBits,
  type UserContextMenuCommandInteraction,
} from 'discord.js'
import { type ContextMenuInteractionOf } from '@src/interface/context-menu-kind.js'

/** The interaction a handler receives from a builder whose `build()` returns `built`. */
const handledBy = <Built>(_built: Built) => expectTypeOf<ContextMenuInteractionOf<Built>>()
type Either = UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction

declare const runtimeKind: boolean

describe("ContextMenuCommandBuilder's setType", () => {
  it('names the kind whether it is set last or first, before other setters', () => {
    const last = new ContextMenuCommandBuilder().setName('Report user').setType(ApplicationCommandType.User)
    const first = new ContextMenuCommandBuilder()
      .setType(ApplicationCommandType.Message)
      .setName('Bookmark')
      .setNameLocalizations({ fr: 'Signet' })
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

    handledBy(last).toEqualTypeOf<UserContextMenuCommandInteraction>()
    handledBy(first).toEqualTypeOf<MessageContextMenuCommandInteraction>()
  })

  it('keeps the kind through a deprecated setter, a helper, and a variable typed as the class', () => {
    const deprecated = new ContextMenuCommandBuilder().setType(ApplicationCommandType.User).setDMPermission(false)
    const named = (name: string) => new ContextMenuCommandBuilder().setName(name)
    const fromHelper = named('Report').setType(ApplicationCommandType.User)
    const plain: ContextMenuCommandBuilder = new ContextMenuCommandBuilder()
    const fromPlain = plain.setType(ApplicationCommandType.Message)

    handledBy(deprecated).toEqualTypeOf<UserContextMenuCommandInteraction>()
    handledBy(fromHelper).toEqualTypeOf<UserContextMenuCommandInteraction>()
    handledBy(fromPlain).toEqualTypeOf<MessageContextMenuCommandInteraction>()
  })

  it('reads the kind from a builder class, as @Command does', () => {
    class ReportBuilder {
      build(commandName: string) {
        return new ContextMenuCommandBuilder().setName(commandName).setType(ApplicationCommandType.User)
      }
    }

    handledBy(new ReportBuilder().build('Report')).toEqualTypeOf<UserContextMenuCommandInteraction>()
  })

  it('leaves either kind when there is none, or it is only known at runtime', () => {
    const unset = new ContextMenuCommandBuilder().setName('Either')
    const chosen = new ContextMenuCommandBuilder().setType(
      runtimeKind ? ApplicationCommandType.User : ApplicationCommandType.Message,
    )

    handledBy(unset).toEqualTypeOf<Either>()
    handledBy(chosen).toEqualTypeOf<Either>()
    expectTypeOf<ContextMenuInteractionOf<object>>().toEqualTypeOf<Either>()
  })

  it('reads the kind as a declaration file writes it, with `| undefined`', () => {
    type Declared = ContextMenuCommandBuilder & {
      readonly '~meocordContextMenuKind'?: ApplicationCommandType.Message | undefined
    }

    expectTypeOf<ContextMenuInteractionOf<Declared>>().toEqualTypeOf<MessageContextMenuCommandInteraction>()
  })

  // With two copies of discord-api-types installed, the builder's own `type` and the app's `ApplicationCommandType`
  // are different enums, and an intersection over `type` would reduce the builder to `never`. `type` is left as it is.
  it("leaves the builder's own type, and its other setters, as discord.js declares them", () => {
    const built = new ContextMenuCommandBuilder().setType(ApplicationCommandType.User)

    expectTypeOf(built.type).toEqualTypeOf<ContextMenuCommandType>()
    expectTypeOf(built.setName('Report')).toEqualTypeOf<typeof built>()
  })

  it('refuses a kind that is not a context menu one', () => {
    // @ts-expect-error a chat input command is not a context menu kind
    new ContextMenuCommandBuilder().setType(ApplicationCommandType.ChatInput)
  })
})
