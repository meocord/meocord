---
'meocord': patch
---

A build resolves your `tsconfig.json` `paths` as TypeScript does. When `compilerOptions.baseUrl` is set, a `paths` target is read from that directory; before, the build read it from the project root, so an alias such as `"@lib/*": ["lib/*"]` with `"baseUrl": "./src"` typechecked but failed to resolve in `meocord build` and `meocord start --dev`. Nothing to change in your project.

`meocord start --dev` rebuilds when you save `meocord.config.ts` or `tsconfig.json`, and each rebuild writes a copy of your `tsconfig.json`. Those copies now share one temporary directory and one exit listener for the session, instead of one each. On Node, a session with several such saves no longer prints `MaxListenersExceededWarning` for `exit`.

A build or `start --dev` that stops before it can clean up, such as one killed, crashed or closed with its terminal, left its directory in your system's temp directory for good. The next build or `start --dev` on the same machine now removes it. Directories left by earlier 4.1 betas, named `meocord-tsconfig-` and six characters, can't be told apart from a build that is still running, so they stay: delete them yourself while no MeoCord build or `start --dev` is running.
