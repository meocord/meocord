export default {
  bracketSpacing: true,
  bracketSameLine: true,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'avoid',
  semi: false,
  endOfLine: 'lf',
  printWidth: 120,
  // The application template is stored under a `.template` suffix so this repository's
  // own tooling does not read it as sources, which also hides its real type from
  // prettier — leaving the code every generated project starts from unformatted by the
  // very config that project is handed.
  //
  // Only the application template is listed. The component templates under
  // `builder-template` put their placeholders in identifier position, as in
  // `export class {{className}}Controller`, which no TypeScript parser accepts.
  overrides: [
    { files: 'src/bin/app-template/**/*.md.template', options: { parser: 'markdown' } },
    { files: 'src/bin/app-template/**/*.json.template', options: { parser: 'json' } },
    { files: 'src/bin/app-template/**/*.mjs.template', options: { parser: 'babel' } },
    { files: 'src/bin/app-template/**/*.ts.template', options: { parser: 'typescript' } },
    { files: 'src/bin/app-template/**/*.yaml.template', options: { parser: 'yaml' } },
  ],
}
