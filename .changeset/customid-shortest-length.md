---
'meocord': patch
---

The warning about a component pattern no customId can match counts each typed param's shortest value: 36 characters for a `uuid`, 17 for a `snowflake`, 2 for a `bool` and the shortest word for words to choose from, rather than one character each. A pattern such as `'q/{a:uuid}/{b:uuid}/{c:uuid}'`, whose shortest customId is 112 characters, over Discord's 100, is now warned about when its handler is declared.
