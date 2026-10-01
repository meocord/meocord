---
'meocord': patch
---

A build resolves your `tsconfig.json` `paths` as TypeScript does. When `compilerOptions.baseUrl` is set, a `paths` target is read from that directory; before, the build read it from the project root, so an alias such as `"@lib/*": ["lib/*"]` with `"baseUrl": "./src"` typechecked but failed to resolve in `meocord build` and `meocord start --dev`. Nothing to change in your project.

`meocord start --dev` rebuilds when you save `meocord.config.ts` or `tsconfig.json`, and each rebuild writes a copy of your `tsconfig.json`. Those copies now share one temporary directory and one exit listener for the session, instead of one each. On Node, a session with several such saves no longer prints `MaxListenersExceededWarning` for `exit`.
