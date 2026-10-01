/**
 * What counts as a `{param}` in a message, one text per case with the params it takes: the one definition the
 * compiler's `Placeholders`, translating and `expectCompleteCatalog` are each tested against, so they can't drift.
 */
export const PLACEHOLDER_CASES = [
  { text: 'Banned {user}.', params: ['user'] },
  { text: '{count} warnings for {user}', params: ['count', 'user'] },
  { text: 'Wrap text in { and }.', params: [] },
  { text: 'Empty braces: {}', params: [] },
  { text: 'Hello {{user}}', params: [] },
  { text: 'A brace, then a param: {{{user}}}', params: ['user'] },
  { text: 'Two braces open: {{user}', params: [] },
  { text: 'Two braces close: {user}}', params: ['user'] },
  { text: 'Spaced: { user }', params: [] },
  { text: 'Not ASCII: {ñ}', params: [] },
  { text: 'Nested: {a{b}}', params: ['b'] },
  { text: 'Snake and digits: {user_id2}', params: ['user_id2'] },
] as const
