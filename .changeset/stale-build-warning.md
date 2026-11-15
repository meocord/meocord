---
'meocord': minor
---

`meocord start --prod` and `meocord register`, run without `--build`, now warn when the build in `dist` is older than your source, naming the first file changed since, and then run that build as before: `dist was built before src/controllers/slash/ping.slash.controller.ts changed, so start --prod runs the previous build. Add --build, or run meocord build --prod first.` They also warn when `dist` holds a development build, as `meocord start --dev` and `meocord build --dev` leave it. The exit code and the bot are unaffected.

Every build writes `dist/meocord.build.json`, recording its mode and, with their size, mtime and SHA-256, the source files it read, `tsconfig.json` and each file it extends, and with `bundleDependencies` your lockfile, whose packages the build copies in. The check reads no file whose size and mtime are unchanged and hashes the rest; it stops after about 200 ms, partway through a large file if need be, and then says nothing. A file whose mtime moved but whose content didn't, as after a checkout or a copy, gives no warning; neither does a `dist` with no recorded source beside it, as on a server that has only `dist`, or one built by an earlier MeoCord. As with git, an edit that keeps a file's size and has its old mtime put back is not seen. See [CLI](https://meocord.dev/docs/4.3/cli).
