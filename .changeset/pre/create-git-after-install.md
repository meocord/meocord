---
'meocord': patch
---

`meocord create` keeps the app when git can't make its first commit. Before, a git failure deleted the app it had just written and exited with an error. That happened on a machine where git has no `user.email` (many fresh Linux machines, containers and CI runners) and on one without git. Now `create` finishes, says what happened, and tells you how to finish the commit. Inside an existing Git repository it makes no new one and leaves the files to that repository.

The first commit now comes after the install, so your lockfile (`bun.lock`, `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`) is part of it, rather than showing as an untracked file in a new app's first `git status`.
