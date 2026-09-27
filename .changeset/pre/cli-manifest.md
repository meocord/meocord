---
'meocord': patch
---

The package includes `dist/cli.json`, which describes the `meocord` CLI: every command and subcommand, with its aliases, arguments, options, defaults, choices and descriptions, in the order `meocord --help` lists them. The build writes it from the program the CLI runs, so it always matches the installed version, and a tool can read it as data, without running the CLI. `schemaVersion` changes only when a change to the shape would break a reader.
