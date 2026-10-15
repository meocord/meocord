---
'meocord': patch
---

A message pattern's own word that starts with `--`, such as `--force` in `deploy --force {env} {--dry}`, is now matched where the pattern has it when the pattern also has flags. `!deploy --force prod`, the message its usage shows, ran nothing and got no reply, since every `--name` was read as a flag first; only `"--force"` in quotes matched. Now `--force` given bare in that place is the word, in the case the command matches words in, and `!deploy --force` gets `env is missing`. Elsewhere in the message, or given a value as `--force=yes`, it is still a flag, and another command that declares `{--force}` still gets it as one.
