---
'meocord': patch
---

Log lines escape every bidirectional control character in text a user wrote, such as a message's content or a command option. The Arabic letter mark (U+061C) and the left-to-right and right-to-left marks (U+200E, U+200F) were written to the log as they are, so a user could reorder how the rest of a log line reads. They now appear escaped, as `\u061c`, `\u200e` and `\u200f`, like the other bidi controls already did.
