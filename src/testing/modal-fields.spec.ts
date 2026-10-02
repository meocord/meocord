import { Attachment, ComponentType } from 'discord.js'
import { createMockInteraction, createModalFields } from '@src/testing/index.js'

describe('createModalFields', () => {
  it('builds a file upload from attachments, as discord.js does from a submit', () => {
    const shot = createMockInteraction(Attachment, { id: '111', name: 'crash.png' })

    const fields = createModalFields({ screenshot: [shot] })

    expect(fields.getField('screenshot')).toMatchObject({ type: ComponentType.FileUpload, customId: 'screenshot', values: ['111'] })
    expect([...fields.getUploadedFiles('screenshot', true).values()]).toEqual([shot])
  })
})
