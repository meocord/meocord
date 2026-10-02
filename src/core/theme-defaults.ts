import { ButtonStyle } from 'discord.js'
import { type DeepReadonly, type ThemeButtons, type ThemeColors, type ThemeEmojis } from '@src/interface/index.js'

/** MeoCord's own roles, which the default theme gives a value; an app's roles have none. */
export interface DefaultTheme {
  colors: Pick<ThemeColors, 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'>
  emojis: Pick<ThemeEmojis, 'loading' | 'success' | 'warning' | 'danger' | 'info'>
  buttons: Pick<ThemeButtons, 'primary' | 'neutral' | 'success' | 'danger'>
}

/** Freezes an object and every object in it. */
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

/**
 * MeoCord's own theme: a value for every role it defines, beneath every theme an app sets. Each colour gives at least
 * 3:1 (WCAG 2.1 SC 1.4.11) against every surface an embed or a container sits on in Discord's light, dark, darker and
 * midnight themes; theme-defaults.spec checks it.
 * Frozen, since one theme is shared by every call.
 */
export const DEFAULT_THEME: DeepReadonly<DefaultTheme> = deepFreeze<DefaultTheme>({
  colors: {
    primary: '#7680F4',
    neutral: '#888B95',
    success: '#26A042',
    warning: '#B08400',
    danger: '#E3606D',
    info: '#1699AE',
  },
  emojis: {
    loading: '⏳',
    success: '✅',
    warning: '⚠️',
    danger: '⛔',
    info: 'ℹ️',
  },
  buttons: {
    primary: ButtonStyle.Primary,
    neutral: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
  },
})
