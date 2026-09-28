import 'reflect-metadata'
import { type ThemeOverride } from '@src/interface/index.js'
import { assertValidTheme } from '@src/core/theme-validation.js'
import { CLASS_THEME, METHOD_THEME, THEMED_CLASSES } from '@src/core/theme-runtime.js'
import { copyLayer } from '@src/core/theme-scope.js'
import { refuse } from '@src/util/refusal.util.js'

/**
 * Sets part of the theme for a controller's handlers, or for one handler.
 *
 * Use it where a controller or a handler looks different from the rest of the app. Only what it names changes; every
 * other role keeps the value beneath it.
 *
 * @remarks
 * It is merged over the app's theme: a class's over its base class's, and a method's over its class's. A subclass
 * inherits its base class's, unless `@Controller({ inheritStages: false })` stops it, as for guards. A bad token stops
 * the bot before it logs in.
 *
 * @param theme - The roles to change, in any of the theme's groups, MeoCord's or the app's.
 * @throws Error naming each token that is not valid, and when a class or method already has a `@UseTheme`.
 *
 * @example
 * ```ts
 * @Controller()
 * @UseTheme({ colors: { primary: '#26A042' } })
 * export class ShopController {
 *   @Command('refund', CommandType.SLASH)
 *   @UseTheme({ colors: { primary: '#E3606D' }, emojis: { loading: '💸' } })
 *   async refund(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send({ embeds: [new EmbedBuilder().setDescription('Refund started.')] })
 *   }
 * }
 * ```
 *
 * @group Decorators
 * @category Controllers
 */
export function UseTheme(theme: ThemeOverride): ClassDecorator & MethodDecorator {
  return function (target: object, propertyKey?: string | symbol) {
    const onClass = propertyKey === undefined
    const owner = (onClass ? target : target.constructor) as { name: string }
    const where = `@UseTheme on ${owner.name}${onClass ? '' : `.${String(propertyKey)}`}`
    assertValidTheme(theme, where)
    const key = onClass ? CLASS_THEME : METHOD_THEME
    const existing = onClass ? Reflect.getOwnMetadata(key, target) : Reflect.getOwnMetadata(key, target, propertyKey!)
    if (existing !== undefined) throw refuse(new Error(`${where}: it has a @UseTheme already; give it one, with every role it changes.`))
    const layer = copyLayer(theme)
    if (onClass) Reflect.defineMetadata(key, layer, target)
    else Reflect.defineMetadata(key, layer, target, propertyKey!)
    THEMED_CLASSES.add(owner)
  } as ClassDecorator & MethodDecorator
}
