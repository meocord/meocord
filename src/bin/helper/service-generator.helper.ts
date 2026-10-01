import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class ServiceGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates a service and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid.
   */
  generateService(serviceName?: string): string[] {
    if (!serviceName) {
      this.logger.error('Service name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(serviceName)

    const serviceDir = path.join(process.cwd(), 'src', 'services', ...parts)
    const serviceFile = path.join(serviceDir, `${kebabCaseName}.service.ts`)
    const specFile = path.join(serviceDir, `${kebabCaseName}.service.spec.ts`)
    // Both files checked before either is written, so an existing service is never replaced.
    assertFilesAbsent([serviceFile, specFile])

    const serviceTemplate = buildTemplate(className, 'service.template')
    const specTemplate = buildTemplate(className, 'service.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(serviceDir)
    return writeFiles([
      [serviceFile, serviceTemplate],
      [specFile, specTemplate],
    ])
  }
}
