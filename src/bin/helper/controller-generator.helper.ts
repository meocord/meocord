import path from 'path'
import { ControllerType } from '@src/enum/controller.enum.js'
import { kebabCase } from 'lodash-es'
import {
  assertFilesAbsent,
  commandNameFor,
  createDirectoryIfNotExists,
  writeFiles,
  populateTemplate,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** The kind of context menu command a context-menu controller handles: a user one, or with `--message` a message one. */
function contextMenuKind(options: { message?: boolean }): { contextMenuType: string; contextMenuInteraction: string } {
  return options.message
    ? { contextMenuType: 'Message', contextMenuInteraction: 'MessageContextMenuCommandInteraction' }
    : { contextMenuType: 'User', contextMenuInteraction: 'UserContextMenuCommandInteraction' }
}

export class ControllerGeneratorHelper {
  /**
   * Generates a controller of the given type, with its spec and, for command types, its builder.
   * @throws Exits the process when the name is invalid or the type unsupported.
   */
  generateController(args: { controllerName: string | undefined }, type: ControllerType, options: { message?: boolean } = {}): string[] {
    const { parts, kebabCaseName, className } = validateAndFormatName(args.controllerName)
    const controllerDir = path.join(process.cwd(), 'src', 'controllers', type, ...parts)

    // Every file this would write, checked before any is: a refusal leaves nothing half-made.
    assertFilesAbsent([
      ...(this.getBuilderConfig(type, className, kebabCaseName, parts, options) ? [this.builderFilePath(controllerDir, kebabCaseName)] : []),
      path.join(controllerDir, `${kebabCaseName}.${type}.controller.ts`),
      path.join(controllerDir, `${kebabCaseName}.${type}.controller.spec.ts`),
    ])

    const template = this.buildControllerTemplate(className, type, parts, kebabCaseName, options)
    return this.generateControllerStructure(controllerDir, kebabCaseName, className, type, template, parts, options)
  }

  /** Where a controller's own builder is written: beside it, named after it. */
  private builderFilePath(controllerDir: string, kebabCaseName: string): string {
    return path.join(controllerDir, 'builders', `${kebabCaseName}.builder.ts`)
  }

  /**
   * Renders the controller file for a controller type.
   * @throws When the controller type is unsupported.
   */
  buildControllerTemplate(
    className: string,
    type: ControllerType,
    parts: string[] = [],
    kebabCaseName: string = kebabCase(className),
    options: { message?: boolean } = {},
  ): string {
    const templateConfig = this.getTemplateConfig(type, className, parts, kebabCaseName, options)
    if (!templateConfig) {
      throw new Error(`Unsupported controller type: ${type}`)
    }
    return populateTemplate(templateConfig.template, templateConfig.variables)
  }

  /** The controller template and its variables for a controller type, or undefined when unsupported. */
  private getTemplateConfig(type: ControllerType, className: string, parts: string[], kebabCaseName: string, options: { message?: boolean }) {
    const baseDir = path.resolve(__dirname, '..', 'builder-template', 'controller')
    const templates: Record<ControllerType, string> = {
      [ControllerType.BUTTON]: 'button.controller.template',
      [ControllerType.MODAL_SUBMIT]: 'modal-submit.controller.template',
      [ControllerType.SELECT_MENU]: 'select-menu.controller.template',
      [ControllerType.USER_SELECT_MENU]: 'user-select-menu.controller.template',
      [ControllerType.ROLE_SELECT_MENU]: 'role-select-menu.controller.template',
      [ControllerType.MENTIONABLE_SELECT_MENU]: 'mentionable-select-menu.controller.template',
      [ControllerType.CHANNEL_SELECT_MENU]: 'channel-select-menu.controller.template',
      [ControllerType.REACTION]: 'reaction.controller.template',
      [ControllerType.MESSAGE]: 'message.controller.template',
      [ControllerType.CONTEXT_MENU]: 'context-menu.controller.template',
      [ControllerType.SLASH]: 'slash.controller.template',
      [ControllerType.AUTOCOMPLETE]: 'autocomplete.controller.template',
      [ControllerType.PRIMARY_ENTRY_POINT]: 'primary-entry-point.controller.template',
    }

    const template = templates[type] ? path.resolve(baseDir, templates[type]) : undefined
    // The builder is written beside the controller and named after it, so each controller
    // imports its own and generating one never touches another's. The path follows any
    // nesting, since the builder moves with the controller.
    const builderImportPath = ['@src/controllers', type, ...parts, 'builders', `${kebabCaseName}.builder`].join('/')
    const variables = {
      className,
      builderImportPath,
      builderClassName: `${className}CommandBuilder`,
      commandName: commandNameFor(parts, kebabCaseName),
      ...contextMenuKind(options),
    }
    return template ? { template, variables } : undefined
  }

  /** Writes the controller, its spec, and for command types its builder, into `controllerDir`, and returns those written. */
  private generateControllerStructure(
    controllerDir: string,
    kebabCaseName: string,
    className: string,
    type: ControllerType,
    controllerTemplate: string,
    parts: string[],
    options: { message?: boolean },
  ): string[] {
    const builder = this.generateBuilderFile(className, kebabCaseName, type, controllerDir, parts, options)
    createDirectoryIfNotExists(controllerDir)

    const controllerFilePath = path.join(controllerDir, `${kebabCaseName}.${type}.controller.ts`)

    // Each type's own spec, which invokes the handler as dispatch would and checks its answer
    const { variables } = this.getTemplateConfig(type, className, parts, kebabCaseName, options)!
    const specTemplatePath = path.resolve(__dirname, '..', 'builder-template', 'controller', `${type}.controller.spec.template`)
    const specContent = populateTemplate(specTemplatePath, { ...variables, kebabCaseName })
    return [
      ...builder,
      ...writeFiles([
        [controllerFilePath, controllerTemplate],
        [path.join(controllerDir, `${kebabCaseName}.${type}.controller.spec.ts`), specContent],
      ]),
    ]
  }

  /** Writes the builder for command controller types into `controllerDir`, returning it when written; other types have none. */
  private generateBuilderFile(
    className: string,
    kebabCaseName: string,
    type: ControllerType,
    controllerDir: string,
    parts: string[],
    options: { message?: boolean },
  ): string[] {
    const builderConfig = this.getBuilderConfig(type, className, kebabCaseName, parts, options)
    if (!builderConfig) return []

    const builderTemplate = populateTemplate(builderConfig.template, builderConfig.variables)
    createDirectoryIfNotExists(path.join(controllerDir, 'builders'))
    return writeFiles([[this.builderFilePath(controllerDir, kebabCaseName), builderTemplate]])
  }

  /** The builder template and its variables for a controller type, or undefined when it has no builder. */
  private getBuilderConfig(type: ControllerType, className: string, kebabCaseName: string, parts: string[], options: { message?: boolean } = {}) {
    const baseDir = path.resolve(__dirname, '..', 'builder-template', 'builder')
    const templates: Partial<Record<ControllerType, string>> = {
      [ControllerType.CONTEXT_MENU]: 'context-menu.builder.template',
      [ControllerType.SLASH]: 'slash.builder.template',
      [ControllerType.PRIMARY_ENTRY_POINT]: 'primary-entry-point.builder.template',
    }

    const template = templates[type] ? path.resolve(baseDir, templates[type]) : undefined
    const variables = {
      className,
      builderClassName: `${className}CommandBuilder`,
      commandName: commandNameFor(parts, kebabCaseName),
      ...contextMenuKind(options),
    }
    return template ? { template, variables } : undefined
  }
}
