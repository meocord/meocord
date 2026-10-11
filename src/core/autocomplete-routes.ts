import { type AutocompleteInteraction } from 'discord.js'
import { getAutocompleteHandlers } from '@src/decorator/controller.decorator.js'
import { type AutocompleteMeta } from '@src/interface/command-decorator.interface.js'
import { focusedOptionName, resolveCommandPaths } from '@src/util/interaction.util.js'

/** An `@Autocomplete` handler and the controller it is declared on. */
export interface AutocompleteRoute<C> {
  controllerClass: C
  meta: AutocompleteMeta
}

/**
 * Every `@Autocomplete` handler of the given controllers, read from their metadata, with the handlers of one option
 * before those of a whole command, so an option's handler wins over its command's whatever order they are declared in.
 */
export function buildAutocompleteRoutes<C extends { prototype: object }>(controllers: readonly C[]): AutocompleteRoute<C>[] {
  const routes = controllers.flatMap(controllerClass => getAutocompleteHandlers(controllerClass.prototype).map(meta => ({ controllerClass, meta })))
  return routes.sort((a, b) => Number(Boolean(b.meta.optionName)) - Number(Boolean(a.meta.optionName)))
}

/**
 * The handler an autocomplete reaches, as dispatch routes it: its full command path, then its command's name, and at
 * each the first handler whose option is the focused one, or that names none.
 */
export function matchAutocompleteRoute<C>(routes: readonly AutocompleteRoute<C>[], interaction: AutocompleteInteraction): AutocompleteRoute<C> | undefined {
  const focused = focusedOptionName(interaction)
  for (const path of resolveCommandPaths(interaction)) {
    const route = routes.find(({ meta }) => meta.commandPath === path && (meta.optionName === undefined || meta.optionName === focused))
    if (route) return route
  }
  return undefined
}
