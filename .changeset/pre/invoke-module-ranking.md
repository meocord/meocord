---
'meocord': patch
---

`invoke` in `meocord/testing` answers a message that names a command without fitting its pattern with that command's usage only where dispatch would. With `config {key}` beside `config set {key} {value...}`, invoking the first with `!config set prefix ?` rejects saying dispatch runs the second, rather than with a usage error the user would never see.
