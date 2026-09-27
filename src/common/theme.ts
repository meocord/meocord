import { type ColorResolvable } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { setLegacyThemeLayer, useTheme } from '@src/core/theme-scope.js'
import { themeProblems } from '@src/core/theme-validation.js'
import { type ThemeColors } from '@src/interface/index.js'

type LegacyColor = 'primaryColor' | 'successColor' | 'infoColor' | 'errorColor' | 'warningColor'
/** Only MeoCord's own roles, whatever an app adds to ThemeColors. */
type LegacyRole = Extract<keyof ThemeColors, 'primary' | 'success' | 'info' | 'danger' | 'warning'>

/** The theme role each static stands for; `errorColor` is a fault in the bot, `danger`. */
const ROLES: Readonly<Record<LegacyColor, LegacyRole>> = {
  primaryColor: 'primary',
  successColor: 'success',
  infoColor: 'info',
  errorColor: 'danger',
  warningColor: 'warning',
}

const logger = new Logger('Theme')
const assigned: Partial<Record<LegacyRole, ColorResolvable>> = {}
const warned = new Set<LegacyColor>()

const read = (name: LegacyColor): ColorResolvable => useTheme().colors[ROLES[name]] as ColorResolvable

/** Sets a role beneath every theme an app sets, as the static once did; a value that is no colour is reported instead. */
function assign(name: LegacyColor, value: ColorResolvable): void {
  const role = ROLES[name]
  if (!warned.has(name)) {
    warned.add(name)
    logger.warn(`Theme.${name} is deprecated: set colors.${role} in @MeoCord({ theme }) instead. Assigning it still works until MeoCord 5.`)
  }
  const [problem] = themeProblems({ colors: { [role]: value } }, `Theme.${name}`)
  if (problem) {
    logger.warn(`${problem}. It was left unset.`)
    return
  }
  assigned[role] = value
  setLegacyThemeLayer({ colors: { ...assigned } })
}

/**
 * The colours MeoCord's views used, before themes.
 *
 * Each one reads the matching role of the theme where it is read, `useTheme().colors`, so code written against it
 * follows `@MeoCord({ theme })` and `@UseTheme` with no change. Assigning one still recolours MeoCord's views, as a
 * role beneath every theme an app sets, and logs a warning once. It goes in MeoCord 5.
 *
 * @deprecated Read `useTheme().colors`, and set the colours in `@MeoCord({ theme })`: `primaryColor` is
 * `colors.primary`, `successColor` `colors.success`, `infoColor` `colors.info`, `errorColor` `colors.danger` and
 * `warningColor` `colors.warning`.
 *
 * @example
 * ```ts
 * // Both colour the embed with the call's primary colour; write the second in new code
 * new EmbedBuilder().setColor(Theme.primaryColor)
 * new EmbedBuilder().setColor(useTheme().colors.primary)
 * ```
 *
 * @group Responses
 */
export class Theme {
  /** @deprecated Read `useTheme().colors.primary`; set `colors.primary` in `@MeoCord({ theme })`. */
  static get primaryColor(): ColorResolvable {
    return read('primaryColor')
  }
  static set primaryColor(value: ColorResolvable) {
    assign('primaryColor', value)
  }

  /** @deprecated Read `useTheme().colors.success`; set `colors.success` in `@MeoCord({ theme })`. */
  static get successColor(): ColorResolvable {
    return read('successColor')
  }
  static set successColor(value: ColorResolvable) {
    assign('successColor', value)
  }

  /** @deprecated Read `useTheme().colors.info`; set `colors.info` in `@MeoCord({ theme })`. */
  static get infoColor(): ColorResolvable {
    return read('infoColor')
  }
  static set infoColor(value: ColorResolvable) {
    assign('infoColor', value)
  }

  /** @deprecated Read `useTheme().colors.danger`; set `colors.danger` in `@MeoCord({ theme })`. */
  static get errorColor(): ColorResolvable {
    return read('errorColor')
  }
  static set errorColor(value: ColorResolvable) {
    assign('errorColor', value)
  }

  /** @deprecated Read `useTheme().colors.warning`; set `colors.warning` in `@MeoCord({ theme })`. */
  static get warningColor(): ColorResolvable {
    return read('warningColor')
  }
  static set warningColor(value: ColorResolvable) {
    assign('warningColor', value)
  }
}

/** Forgets what the statics were set to, and which have warned: for specs. */
export function resetThemeStatics(): void {
  for (const role of Object.keys(assigned) as LegacyRole[]) delete assigned[role]
  warned.clear()
  setLegacyThemeLayer(undefined)
}
