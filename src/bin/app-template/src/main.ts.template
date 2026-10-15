import App from '@src/app'
import { isExplainedError, Logger } from 'meocord/common'
import { MeoCordFactory } from 'meocord/core'

const logger = new Logger()

async function bootstrap() {
  logger.log('Starting application')
  const app = MeoCordFactory.create(App)
  await app.start()
  logger.log('Application started')
}

// An error MeoCord explained, such as an app it refuses or a token Discord refused, is already logged, with the exit code set
bootstrap().catch(error => {
  if (isExplainedError(error)) return
  logger.error('Error during startup:', error)
  process.exitCode = 1
})
