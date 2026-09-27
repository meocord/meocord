import { ComponentType, ModalSubmitFields } from 'discord.js'

/**
 * Builds the `fields` of a submitted form, as discord.js does when a user submits one.
 *
 * Use it for a mock `ModalSubmitInteraction`: discord.js keeps the `ModalSubmitFields` constructor private, so a test
 * cannot build one directly.
 *
 * @param values - Each field's value, keyed by its customId: a string for a text input, an array for a select's
 *   chosen values.
 * @returns Fields that `getTextInputValue`, `getStringSelectValues` and a handler's params all read.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const interaction = createMockInteraction(ModalSubmitInteraction, {
 *   customId: 'feedback/bugs',
 *   fields: createModalFields({ body: 'It crashed', area: ['login'] }),
 * })
 * expect(interaction.fields.getTextInputValue('body')).toBe('It crashed')
 * expect(interaction.fields.getStringSelectValues('area')).toEqual(['login'])
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockInteraction}
 */
export function createModalFields(values: Record<string, string | string[]>): ModalSubmitFields {
  const components = Object.entries(values).map(([customId, value]) => ({
    type: ComponentType.Label,
    component: Array.isArray(value)
      ? { type: ComponentType.StringSelect, customId, values: value }
      : { type: ComponentType.TextInput, customId, value },
  }))

  const Fields = ModalSubmitFields as unknown as new (components: unknown[]) => ModalSubmitFields
  return new Fields(components)
}
