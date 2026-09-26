---
'meocord': patch
---

`MEOCORD_LOG_LEVEL` is read in any case, so `MEOCORD_LOG_LEVEL=DEBUG` shows debug lines rather than being rejected. A value that names no level is reported even when the configured `logLevel` is `error` or `silent`, which hid the warning, so a bot that prints nothing tells you why your override did not apply.
