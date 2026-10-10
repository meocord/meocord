---
'meocord': patch
---

Help rendered from your catalog's `meocord.help` texts now keeps its lists apart in every language, on Node and Bun alike: params join with `·` and aliases with `, `, as in MeoCord's English. Before, zh-CN ran them together, ja and ru joined them with a space, and de joined the last two with "und". MeoCord's own English help is unchanged. A test that pins translated help sees the new separators. See [Message commands](https://meocord.dev/docs/4.2/message-commands).
