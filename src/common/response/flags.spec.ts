import { MessageFlags } from 'discord.js'
import { droppedFlagsWarning, hasComponentsV2, hasEphemeral, resolveFlags } from '@src/common/response/flags.js'

const { Ephemeral, IsComponentsV2, SuppressEmbeds, SuppressNotifications } = MessageFlags

describe('resolveFlags', () => {
  it('keeps IsComponentsV2 on an edit or an update of a Components V2 message, and only there', () => {
    expect(resolveFlags('edit', undefined, true).flags).toBe(IsComponentsV2)
    expect(resolveFlags('update', undefined, true).flags).toBe(IsComponentsV2)
    expect(resolveFlags('reply', undefined, true).flags).toBe(0)
    expect(resolveFlags('followUp', undefined, true).flags).toBe(0)
    expect(resolveFlags('deferReply', undefined, true).flags).toBe(0)
    expect(resolveFlags('edit', undefined, false).flags).toBe(0)
  })

  it('reports what a call cannot take as dropped', () => {
    expect(resolveFlags('edit', Ephemeral | SuppressNotifications, false)).toEqual({ flags: 0, dropped: Ephemeral | SuppressNotifications })
  })
})

describe('hasComponentsV2 and hasEphemeral', () => {
  it('read their flag, and nothing from no flags', () => {
    expect(hasComponentsV2(IsComponentsV2 | Ephemeral)).toBe(true)
    expect(hasComponentsV2(Ephemeral)).toBe(false)
    expect(hasComponentsV2(undefined)).toBe(false)
    expect(hasEphemeral(Ephemeral)).toBe(true)
    expect(hasEphemeral(undefined)).toBe(false)
  })
})

describe('droppedFlagsWarning', () => {
  const followUp = 'use respond(interaction).followUp() with MessageFlags.Ephemeral.'

  it('names each call with its article', () => {
    expect(droppedFlagsWarning('deferReply', SuppressEmbeds)).toBe('Dropped flags SuppressEmbeds, which a deferred reply cannot take.')
    expect(droppedFlagsWarning('reply', SuppressEmbeds)).toBe('Dropped flags SuppressEmbeds, which a reply cannot take.')
    expect(droppedFlagsWarning('update', SuppressNotifications)).toBe('Dropped flags SuppressNotifications, which an update cannot take.')
    expect(droppedFlagsWarning('edit', SuppressNotifications)).toBe('Dropped flags SuppressNotifications, which an edit cannot take.')
    expect(droppedFlagsWarning('followUp', SuppressEmbeds)).toBe('Dropped flags SuppressEmbeds, which a follow-up cannot take.')
  })

  it('says how to answer privately when an update or an edit drops Ephemeral', () => {
    expect(droppedFlagsWarning('update', Ephemeral)).toBe(
      `Dropped flags Ephemeral, which an update cannot take. An update changes the message the member clicked, for everyone; to answer only them, ${followUp}`,
    )
    expect(droppedFlagsWarning('edit', Ephemeral | SuppressNotifications)).toBe(
      `Dropped flags Ephemeral, SuppressNotifications, which an edit cannot take. An edit keeps the message as public or private as it was; to answer only the member, ${followUp}`,
    )
  })
})
