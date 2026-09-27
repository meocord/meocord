---
'meocord': minor
---

A message that names only a command's leading words, such as `!config` when `config set …` and `config get …` exist, or an unknown subcommand, such as `!config reset`, gets the usage of each subcommand in reply, under a `Usage:` heading, one line per handler by its own pattern, where it got no reply. A handler whose pattern matches the message still runs, so a `config` or `config {key}` handler takes it as before. A subcommand with a guard, on its method or its controller, inherited ones included, is left out of the listing on purpose, since the listing runs no guards and must not name what a caller may be refused; it still answers its own usage when named, and a parent with nothing left to list gets no reply. App-wide guards do not filter the listing, as they do not filter a usage reply. The reply is a `MessageUsageError`, answered through the app's global filters and then the fallback, like any usage reply.
