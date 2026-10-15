import { createTranslator, defineCatalog } from '@src/common/index.js'
import { renderText } from '@src/common/meocord-text.js'

describe('renderText', () => {
  const enUS = defineCatalog({ items: { one: '{count} item', other: '{count} items' } })
  // The form for one left empty, as translation tools export one nobody has translated yet
  const fr = { items: { one: '', other: '{count} articles' } }
  const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, fr } })

  it("reads a text whose form for the count is empty in the next catalog of the locale's chain", () => {
    expect([1, 2].map(count => renderText(t, 'fr', { key: 'items', params: { count } }))).toEqual(['1 item', '2 articles'])
  })
})
