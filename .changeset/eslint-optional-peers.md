---
'meocord': patch
---

`meocord/eslint` now names the packages it needs as optional peer dependencies: `eslint`, `typescript`, `prettier`, `typescript-eslint`, `@typescript-eslint/parser`, `eslint-plugin-import-x`, `eslint-plugin-prettier`, `eslint-config-prettier`, `eslint-import-resolver-typescript` and `globals`. A project that adopts the config by hand, rather than through `meocord create`, found each of them only through a `Cannot find package` error.

The peers constrain no version, so installing or upgrading `meocord` changes nothing in a project, whichever versions of these packages it has, prereleases included. To use the config, install them at least at the versions it works with:

```bash
npm install --save-dev "eslint@>=8.57.0" "typescript@>=4.8.4 <6.1" "prettier@>=3.0.0" "typescript-eslint@>=8.0.0" "@typescript-eslint/parser@>=8.0.0" "eslint-plugin-import-x@>=4.13.2" "eslint-plugin-prettier@>=5.0.0" "eslint-config-prettier@>=7.0.0" "eslint-import-resolver-typescript@>=4.0.0" globals
```

`typescript` stays below 6.1 until typescript-eslint supports TypeScript 7. See [ESLint](https://meocord.dev/docs/4.3/eslint).
