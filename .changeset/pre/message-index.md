---
'meocord': patch
---

Matching a message against `@MessageHandler` patterns costs the same however many patterns an app has. The patterns are compiled once into an index of their words, a message's words are read once rather than once per pattern, and a message whose first character no prefix or mention begins with is turned away before it is read at all. At 1000 patterns a matching message costs about 0.4 µs where it cost about 0.4 ms, and ordinary chat about 20 ns where it cost 25–50 µs. Which handler a message reaches, and the params it receives, are unchanged.
