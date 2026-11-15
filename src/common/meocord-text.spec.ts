import { createTranslator, defineCatalog } from '@src/common/index.js'
import { renderText, textRenderer } from '@src/common/meocord-text.js'

describe('renderText', () => {
  const enUS = defineCatalog({ items: { one: '{count} item', other: '{count} items' } })
  // The form for one left empty, as translation tools export one nobody has translated yet
  const fr = { items: { one: '', other: '{count} articles' } }
  const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, fr } })

  it("reads a text whose form for the count is empty in the next catalog of the locale's chain", () => {
    expect([1, 2].map(count => renderText(t, 'fr', { key: 'items', params: { count } }))).toEqual(['1 item', '2 articles'])
  })
})

describe('a unit list that names the text joining it', () => {
  const t = createTranslator({
    default: 'en-US',
    locales: {
      'en-US': { joiner: ' + ', sum: 'Sum: {terms}' },
      ja: { meocord: { duration: { joiner: '、' } }, joiner: '・', sum: '合計：{terms}' },
      de: { sum: 'Summe: {terms}' },
    },
  })
  const terms = (joinerKey?: string) => ({ list: ['a', 'b', 'c'], style: 'unit' as const, ...(joinerKey !== undefined && { joinerKey }) })

  it('is joined by that text in the locale it renders in, falling back to English', () => {
    expect([
      renderText(t, 'ja', { key: 'sum', params: { terms: terms('joiner') } }),
      renderText(t, 'de', { key: 'sum', params: { terms: terms('joiner') } }),
      renderText(t, 'ja', { key: 'sum', params: { terms: terms('meocord.duration.joiner') } }),
      renderText(t, 'de', { key: 'sum', params: { terms: terms('meocord.duration.joiner') } }),
      textRenderer(t, 'ja')(terms('joiner')),
    ]).toEqual(['合計：a・b・c', 'Summe: a + b + c', '合計：a、b、c', 'Summe: a, b, c', 'a・b・c'])
  })

  it('keeps its fixed joiner when it names no text, or a text nothing has', () => {
    expect([
      renderText(t, 'ja', { key: 'sum', params: { terms: terms() } }),
      renderText(t, 'ja', { key: 'sum', params: { terms: { ...terms('nowhere'), joiner: ' / ' } } }),
    ]).toEqual(['合計：a, b, c', '合計：a / b / c'])
  })

  it('reads an empty joiner text as missing, as tools export an untranslated one, and falls back down the chain', () => {
    const untranslated = createTranslator({
      default: 'en-US',
      locales: { 'en-US': { joiner: ' + ', sum: 'Sum: {terms}' }, 'zh-CN': { meocord: { duration: { joiner: '' } }, joiner: '', sum: '合计：{terms}' } },
    })

    expect([
      renderText(untranslated, 'zh-CN', { key: 'sum', params: { terms: terms('joiner') } }),
      renderText(untranslated, 'zh-CN', { key: 'sum', params: { terms: terms('meocord.duration.joiner') } }),
    ]).toEqual(['合计：a + b + c', '合计：a, b, c'])
  })
})
