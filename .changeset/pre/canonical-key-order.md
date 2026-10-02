---
'meocord': patch
---

`respond()` could see a locked message's content as changed when it wasn't. It compares the message with what MeoCord last wrote by sorting keys with the runtime's collation, which ranks two different keys equal when they differ only in Unicode normalization, such as `café` written with `é` and with `e` and a combining accent. Their order then followed the input, so equal content could compare unequal. Keys are now sorted in code-unit order, which needs no locale. This also no longer loads the runtime's ICU data on the first lock or restore. Nothing to change in your code.
