---
'meocord': patch
---

Two fixes to what `meocord.config.ts` problems say:

- A config that still declares a `webpack` hook gets one message from a command that builds, the error that asks for it to be rewritten as `rsbuild`. It also got "webpack is not a MeoCord option, so it has no effect", which said the opposite of the refusal that followed. A command that runs a build made before, such as `meocord register` or `start --prod` without `--build`, still only warns.
- A string value in a validation error is quoted as other messages quote it, between double quotes with its line breaks escaped, so a value holding a newline can no longer read as another problem in the list. For example, `logLevel must be … (got "verbose")`.
