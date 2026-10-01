---
'meocord': patch
---

A build resolves your `paths` from `compilerOptions.baseUrl` when your `tsconfig.json` sets it, as TypeScript does. Before, the build read every `paths` target from the project root, so an alias such as `"@lib/*": ["lib/*"]` with `"baseUrl": "./src"` typechecked but failed to resolve in `meocord build` and `meocord start --dev`. A `baseUrl` your `tsconfig.json` only inherits through `extends` isn't applied to the `paths` it sets itself, so declare those `paths` relative to the project's own `tsconfig.json`.

`meocord start --dev` rebuilds when you save `meocord.config.ts` or `tsconfig.json`, and each rebuild writes a copy of your `tsconfig.json`. Those copies now share one temporary directory and one exit listener for the session, instead of one each. On Node, a session with several such saves no longer prints `MaxListenersExceededWarning` for `exit`.

A build or `start --dev` that stops before it can clean up, such as one killed, crashed or closed with its terminal, left its directory in your system's temp directory for good. The next build or `start --dev` on the same machine now removes it. Directories left by earlier 4.1 betas, named `meocord-tsconfig-` and six characters, can't be told apart from a build that is still running, so they stay: delete them yourself while no MeoCord build or `start --dev` is running.
