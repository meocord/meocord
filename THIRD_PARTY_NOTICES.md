# Third-Party Notices

MeoCord is licensed under the [MIT License](./LICENSE). It depends on the open-source packages
below, each under its own license.

npm installs each dependency alongside MeoCord, with its own license file. MeoCord's CommonJS build
also carries a copy of its ES-module-only dependencies, so that `require()` loads it; those copies
are listed with their license texts. This list is a record of what MeoCord relies on, and of the
terms those packages are offered under. One published interface is declared in MeoCord's own types
instead of installed; it is listed last.

## Dependencies

Installed with MeoCord.

| Package                                                                              | License    | Source                                        |
| ------------------------------------------------------------------------------------ | ---------- | --------------------------------------------- |
| [@clack/prompts](https://www.npmjs.com/package/@clack/prompts)                       | MIT        | https://github.com/bombshell-dev/clack        |
| [@jridgewell/trace-mapping](https://www.npmjs.com/package/@jridgewell/trace-mapping) | MIT        | https://github.com/jridgewell/sourcemaps      |
| [@rsbuild/core](https://www.npmjs.com/package/@rsbuild/core)                         | MIT        | https://github.com/web-infra-dev/rsbuild      |
| [chalk](https://www.npmjs.com/package/chalk)                                         | MIT        | https://github.com/chalk/chalk                |
| [cli-table3](https://www.npmjs.com/package/cli-table3)                               | MIT        | https://github.com/cli-table/cli-table3       |
| [commander](https://www.npmjs.com/package/commander)                                 | MIT        | https://github.com/tj/commander.js            |
| [dayjs](https://www.npmjs.com/package/dayjs)                                         | MIT        | https://github.com/iamkun/dayjs               |
| [get-tsconfig](https://www.npmjs.com/package/get-tsconfig)                           | MIT        | https://github.com/privatenumber/get-tsconfig |
| [inversify](https://www.npmjs.com/package/inversify)                                 | MIT        | https://github.com/inversify/monorepo         |
| [jiti](https://www.npmjs.com/package/jiti)                                           | MIT        | https://github.com/unjs/jiti                  |
| [lodash-es](https://www.npmjs.com/package/lodash-es)                                 | MIT        | https://github.com/lodash/lodash              |
| [reflect-metadata](https://www.npmjs.com/package/reflect-metadata)                   | Apache-2.0 | https://github.com/rbuckton/reflect-metadata  |

## Peer dependencies

Installed by the application using MeoCord.

| Package                                                | License      | Source                                  |
| ------------------------------------------------------ | ------------ | --------------------------------------- |
| [discord.js](https://www.npmjs.com/package/discord.js) | Apache-2.0   | https://github.com/discordjs/discord.js |
| [dotenv](https://www.npmjs.com/package/dotenv)         | BSD-2-Clause | https://github.com/motdotla/dotenv      |

## Bundled into the CommonJS build

Copied into `dist/cjs`, because they ship only as ES modules. The ES module build imports the
installed packages instead.

| Package                                                                                                  | License | Source                                |
| -------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------- |
| [@inversifyjs/common](https://www.npmjs.com/package/@inversifyjs/common)                                 | MIT     | https://github.com/inversify/monorepo |
| [@inversifyjs/container](https://www.npmjs.com/package/@inversifyjs/container)                           | MIT     | https://github.com/inversify/monorepo |
| [@inversifyjs/core](https://www.npmjs.com/package/@inversifyjs/core)                                     | MIT     | https://github.com/inversify/monorepo |
| [@inversifyjs/plugin](https://www.npmjs.com/package/@inversifyjs/plugin)                                 | MIT     | https://github.com/inversify/monorepo |
| [@inversifyjs/prototype-utils](https://www.npmjs.com/package/@inversifyjs/prototype-utils)               | MIT     | https://github.com/inversify/monorepo |
| [@inversifyjs/reflect-metadata-utils](https://www.npmjs.com/package/@inversifyjs/reflect-metadata-utils) | MIT     | https://github.com/inversify/monorepo |
| [chalk](https://www.npmjs.com/package/chalk)                                                             | MIT     | https://github.com/chalk/chalk        |
| [inversify](https://www.npmjs.com/package/inversify)                                                     | MIT     | https://github.com/inversify/monorepo |

### @inversifyjs/common, @inversifyjs/container, @inversifyjs/core, @inversifyjs/plugin, @inversifyjs/prototype-utils, @inversifyjs/reflect-metadata-utils

```text
MIT License

Copyright (c) 2024 inversify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### chalk

```text
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### inversify

```text
The MIT License (MIT)

Copyright (c) 2015-2025 Remo H. Jansen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Interfaces

Declared in MeoCord's type definitions, following a published specification, rather than installed.

| Specification                                 | License | Source                                             | Declared as                               |
| --------------------------------------------- | ------- | -------------------------------------------------- | ----------------------------------------- |
| [Standard Schema](https://standardschema.dev) | MIT     | https://github.com/standard-schema/standard-schema | `StandardSchemaV1` in `meocord/interface` |

---

Generated by `scripts/third-party-notices.ts` from the installed packages. Run
`bun run notices` after adding or removing a dependency.
