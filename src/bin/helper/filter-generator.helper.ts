import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class FilterGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates an exception filter and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid, or a file it would write exists.
   */
  generateFilter(filterName?: string): string[] {
    if (!filterName) {
      this.logger.error('Filter name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(filterName)

    const filterDir = path.join(process.cwd(), 'src', 'filters', ...parts)
    const filterFile = path.join(filterDir, `${kebabCaseName}.filter.ts`)
    const specFile = path.join(filterDir, `${kebabCaseName}.filter.spec.ts`)
    // Both files checked before either is written, so an existing filter is never replaced.
    assertFilesAbsent([filterFile, specFile])

    const filterTemplate = buildTemplate(className, 'filter.template', { kebabCaseName })
    const specTemplate = buildTemplate(className, 'filter.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(filterDir)
    return writeFiles([
      [filterFile, filterTemplate],
      [specFile, specTemplate],
    ])
  }
}
