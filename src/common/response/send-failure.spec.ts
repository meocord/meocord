import { vi } from 'vitest'
import { DiscordAPIError } from 'discord.js'
import { logFailedSend } from '@src/common/response/send-failure.js'

const refusal = (code: number, status: number, message: string) =>
  new DiscordAPIError({ code, message }, code, status, 'POST', '/interactions/1/token/callback', {})

const logger = () => ({ debug: vi.fn(), error: vi.fn() })

describe('logFailedSend', () => {
  // What Discord reports about the interaction, the message or the bot's access, which no code could have avoided
  it.each([
    [10062, 404, 'Unknown interaction'],
    [40060, 400, 'Interaction has already been acknowledged'],
    [10008, 404, 'Unknown message'],
    [50013, 403, 'Missing Permissions'],
    [50007, 403, 'Cannot send messages to this user'],
  ])('logs refusal %i at debug', (code, status, message) => {
    const log = logger()

    logFailedSend(log, 'reply to the message', refusal(code, status, message))

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(log.error).not.toHaveBeenCalled()
  })

  // A body Discord could not read, which only the code that built it can fix
  it.each([
    [50035, 'Invalid Form Body'],
    [50109, 'The request body contains invalid JSON.'],
    [50006, 'Cannot send an empty message'],
  ])('logs refusal %i as an error, with the error', (code, message) => {
    const log = logger()
    const error = refusal(code, 400, message)

    logFailedSend(log, 'reply to the message', error)

    expect(log.error).toHaveBeenCalledWith('Could not reply to the message:', error)
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('logs any other failure as an error, with the error', () => {
    const log = logger()
    const error = new Error('boom')

    logFailedSend(log, 'reply to the message', error)

    expect(log.error).toHaveBeenCalledWith('Could not reply to the message:', error)
  })
})
