import { vi } from 'vitest'
import { ComponentType } from 'discord.js'
import { countComponents, lockComponents, sameEmbed, sameJson, withoutRenderedViews } from '@src/common/response/components.js'
import { RENDERED_CONTAINER_ID } from '@src/common/response/presenter.js'

type Json = Record<string, unknown>
const button = (custom_id: string, extra: Json = {}): Json => ({ type: ComponentType.Button, style: 1, custom_id, ...extra })
const row = (...components: Json[]): Json => ({ type: ComponentType.ActionRow, components })

describe('lockComponents', () => {
  it('disables every select menu type, and buttons, leaving other nodes as they were', () => {
    const selects = [
      ComponentType.StringSelect,
      ComponentType.UserSelect,
      ComponentType.RoleSelect,
      ComponentType.MentionableSelect,
      ComponentType.ChannelSelect,
    ].map(type => row({ type, custom_id: `pick-${type}` }))
    const text = { type: ComponentType.TextDisplay, content: 'hello' }

    const locked = lockComponents([...selects, row(button('go')), text], { disable: 'all' })

    for (const locking of locked.slice(0, 6)) expect((locking.components as Json[])[0].disabled).toBe(true)
    expect(locked[6]).toBe(text)
  })

  it("disables a section's accessory, and leaves a section without one alone", () => {
    const section = { type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay, content: 'x' }], accessory: button('more') }
    const plain = { type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay, content: 'y' }] }

    const [locked, untouched] = lockComponents([section, plain], { disable: 'all' })

    expect(locked).toEqual({ ...section, accessory: { ...button('more'), disabled: true } })
    expect(untouched).toEqual(plain)
  })

  it('shows the loading emoji on the clicked button only, and never on a select or with no click', () => {
    const components = [row(button('a', { emoji: { name: '🔄' } }), button('b')), row({ type: ComponentType.StringSelect, custom_id: 'a' })]

    const clicked = lockComponents(components, { disable: 'all', clickedId: 'b', loadingEmoji: '⏳' })
    const unclicked = lockComponents(components, { disable: 'all', loadingEmoji: '⏳' })
    const selectClicked = lockComponents(components, { disable: 'all', clickedId: 'a', loadingEmoji: '⏳' })

    expect((clicked[0].components as Json[]).map(node => node.emoji)).toEqual([{ name: '🔄' }, { name: '⏳' }])
    expect((unclicked[0].components as Json[]).map(node => node.emoji)).toEqual([{ name: '🔄' }, undefined])
    expect((selectClicked[1].components as Json[])[0]).not.toHaveProperty('emoji')
  })

  it('shows no loading emoji on a link button, which has no customId, when nothing was clicked', () => {
    const link = { type: ComponentType.Button, style: 5, url: 'https://example.com', label: 'Docs' }

    const [locked] = lockComponents([row(link)], { disable: 'all', loadingEmoji: '⏳' })

    expect((locked.components as Json[])[0]).not.toHaveProperty('emoji')
  })

  it("parses a custom loading emoji into Discord's id, name and animated", () => {
    const [locked] = lockComponents([row(button('go'))], { disable: 'all', clickedId: 'go', loadingEmoji: '<a:spin:123456789012345678>' })

    expect((locked.components as Json[])[0].emoji).toEqual({ id: '123456789012345678', name: 'spin', animated: true })
  })

  it("with 'clicked', disables only the control used", () => {
    const [locked] = lockComponents([row(button('a'), button('b'))], { disable: 'clicked', clickedId: 'b' })

    expect((locked.components as Json[]).map(node => node.disabled)).toEqual([undefined, true])
  })
})

describe('countComponents', () => {
  it('counts every component, nested ones and section accessories included', () => {
    const container = {
      type: ComponentType.Container,
      components: [
        { type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay }, { type: ComponentType.TextDisplay }], accessory: button('x') },
        row(button('a'), button('b')),
      ],
    }

    // container 1 + section 1 + 2 texts + accessory 1 + row 1 + 2 buttons
    expect(countComponents([container])).toBe(8)
    expect(countComponents([{ type: ComponentType.TextDisplay }, { type: ComponentType.Separator }])).toBe(2)
    expect(countComponents([])).toBe(0)
  })
})

describe('withoutRenderedViews', () => {
  it("drops only the containers carrying MeoCord's id", () => {
    const mine = { type: ComponentType.Container, id: RENDERED_CONTAINER_ID, components: [] }
    const theirs = { type: ComponentType.Container, id: 7, components: [] }
    const other = { type: ComponentType.TextDisplay, id: RENDERED_CONTAINER_ID }

    expect(withoutRenderedViews([mine, theirs, other])).toEqual([theirs, other])
  })
})

describe('sameJson', () => {
  it('ignores key order and undefined entries, at every depth, and compares everything else', () => {
    expect(sameJson({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true)
    expect(sameJson({ a: 1, gone: undefined }, { a: 1 })).toBe(true)
    expect(sameJson([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }])).toBe(false)
    expect(sameJson({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(sameJson('x', 'x')).toBe(true)
    expect(sameJson(null, {})).toBe(false)
    expect(sameJson([1, 2], { 0: 1, 1: 2 })).toBe(false)
  })

  // Collation would load ICU on first use, which a canonical key order has no need of, and could rank two keys equal
  it('orders keys by code unit, never by a locale', () => {
    const collate = vi.spyOn(String.prototype, 'localeCompare')
    const composed = { 'caf\u00e9': 1, 'cafe\u0301': 2 }

    expect(sameJson(composed, { 'cafe\u0301': 2, 'caf\u00e9': 1 })).toBe(true)
    expect(sameEmbed({ title: 'x', fields: [{ name: 'a', value: 'b' }] }, { fields: [{ value: 'b', name: 'a' }], title: 'x' })).toBe(true)
    expect(collate).not.toHaveBeenCalled()
    collate.mockRestore()
  })
})

describe('sameEmbed', () => {
  const base = { title: 't', description: 'd', color: 1 }

  it('ignores what Discord adds, such as type', () => {
    expect(sameEmbed({ ...base, type: 'rich', content_scan_version: 0 }, base)).toBe(true)
  })

  it.each([
    ['title', 'other'],
    ['description', 'other'],
    ['url', 'https://example.com'],
    ['timestamp', '2026-01-01T00:00:00.000Z'],
    ['color', 2],
    ['footer', { text: 'f' }],
    ['image', { url: 'https://example.com/i.png' }],
    ['thumbnail', { url: 'https://example.com/t.png' }],
    ['video', { url: 'https://example.com/v.mp4' }],
    ['provider', { name: 'p' }],
    ['author', { name: 'a' }],
    ['fields', [{ name: 'n', value: 'v' }]],
  ])('tells embeds apart by their %s', (key, value) => {
    expect(sameEmbed({ ...base, [key]: value }, base)).toBe(false)
  })
})
