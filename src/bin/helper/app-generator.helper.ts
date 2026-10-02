import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Marks a packaged template file, and is dropped from the name that gets written. */
const TEMPLATE_SUFFIX = '.template'

/**
 * Stands in for a leading dot while the file is packaged.
 *
 * npm omits a `.gitignore` from a published tarball, and this repository's own tooling
 * would treat a packaged `.ts` as one of its sources, so nothing here is stored under
 * the name it is written as.
 */
const DOT_PREFIX = '_'

/** Values substituted into the template's `{{...}}` placeholders. */
export interface AppTemplateVariables extends Record<string, string> {
  /** Package name for the generated application, in kebab case. */
  appName: string
  /** Human-readable name, used for the logger prefix and the README heading. */
  displayName: string
  /** Version of the framework doing the generating, which the application pins. */
  version: string
  /** Package manager the application was created with, used in its README examples. */
  packageManager: string
  /**
   * Prefix that puts the framework's own commands on the chosen runtime.
   *
   * Only the `meocord` scripts carry it. Applying the runtime project-wide, through
   * bun's `[run] bun = true`, would also move the linter and the test runner onto it,
   * which is a much larger claim than the application needs to make.
   */
  runtimePrefix: string
}

/**
 * The prefix each package manager needs to run the framework on its runtime.
 * The trailing space is part of the value: the template writes `{{runtimePrefix}}meocord`.
 */
const RUNTIME_PREFIXES: Record<string, string> = {
  // Without `--bun`, bun honours the CLI's `#!/usr/bin/env node` line and hands it to
  // node, which an image built on bun alone does not have.
  bun: 'bun --bun ',
}

/** Files only one package manager reads, by the path they are written to, which an app made with another goes without. */
const PACKAGE_MANAGER_FILES: Record<string, string> = {
  'pnpm-workspace.yaml': 'pnpm',
}

/**
 * What one package manager reads from `package.json`, added after the template's fields for an app made with it.
 *
 * npm 11.16 and later warn about each dependency install script it neither allows nor denies. None of these is needed:
 * @swc/core and unrs-resolver only check the per-platform binding npm installs, and fsevents ships its binary prebuilt.
 * npm also leaves a denied package's bins unlinked, and none of these has one.
 */
const PACKAGE_MANAGER_FIELDS: Record<string, Record<string, unknown>> = {
  npm: { allowScripts: { '@swc/core': false, fsevents: false, 'unrs-resolver': false } },
}

/** The script prefix for a package manager, such as `bun ` for bun. */
export function runtimePrefixFor(packageManager: string): string {
  return RUNTIME_PREFIXES[packageManager] ?? ''
}

/**
 * `value` as a TypeScript string literal, quoted as the generated app's Prettier config writes it: in single quotes,
 * or in double quotes when it holds more single quotes than double, so the file passes the app's lint unchanged.
 */
export function stringLiteral(value: string): string {
  const count = (quote: string) => value.split(quote).length - 1
  const quote = count("'") > count('"') ? '"' : "'"
  const escaped = value.replace(/[\\\u0000-\u001f\u2028\u2029'"]/g, char => {
    if (char === '\\') return '\\\\'
    if (char === "'" || char === '"') return char === quote ? `\\${char}` : char
    const named: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
    return named[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
  return `${quote}${escaped}${quote}`
}

/**
 * Renders a packaged template. In a TypeScript template, a placeholder in quotes, such as `'{{displayName}}'`, is
 * written whole as a string literal of its value, so a name with a quote or a backslash still makes valid code.
 */
function renderTemplate(templatePath: string, variables: AppTemplateVariables): string {
  const typescript = templatePath.endsWith(`.ts${TEMPLATE_SUFFIX}`)
  let text = fs.readFileSync(templatePath, 'utf8')
  for (const [key, value] of Object.entries(variables)) {
    if (typescript) text = text.replaceAll(`'{{${key}}}'`, stringLiteral(value))
    text = text.replaceAll(`{{${key}}}`, value)
  }
  return text
}

/** The name a packaged template is written under. */
function outputName(templateName: string): string {
  const name = templateName.endsWith(TEMPLATE_SUFFIX)
    ? templateName.slice(0, -TEMPLATE_SUFFIX.length)
    : templateName

  return name.startsWith(DOT_PREFIX) ? `.${name.slice(DOT_PREFIX.length)}` : name
}

/**
 * Writes a new application from the template packaged with this framework, so a release always
 * scaffolds an application that same release can run.
 */
export class AppGeneratorHelper {
  private readonly templateDir = path.resolve(__dirname, '..', 'app-template')

  /**
   * Renders every packaged template file into `targetDir`, but one that only another package manager reads, returning
   * the written paths relative to it.
   */
  generateApp(targetDir: string, variables: AppTemplateVariables): string[] {
    return this.templateFiles(this.templateDir).flatMap(templatePath => {
      const relative = path
        .relative(this.templateDir, templatePath)
        .split(path.sep)
        .map(segment => outputName(segment))
        .join(path.sep)
      const readBy = PACKAGE_MANAGER_FILES[relative]
      if (readBy !== undefined && readBy !== variables.packageManager) return []

      const destination = path.join(targetDir, relative)
      const fields = relative === 'package.json' ? PACKAGE_MANAGER_FIELDS[variables.packageManager] : undefined
      const rendered = renderTemplate(templatePath, variables)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, fields ? `${JSON.stringify({ ...JSON.parse(rendered), ...fields }, null, 2)}\n` : rendered)

      return [relative]
    })
  }

  private templateFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? this.templateFiles(full) : [full]
    })
  }
}
