---
'meocord': patch
---

An observer's `startedAt` and `durationMs` for a message's or a reaction's handlers now run from when dispatch received it, as the `DispatchResult` JSDoc and the Observers guide say, and as they already did for an interaction. Every handler of one message or reaction reports the same `startedAt`, and a listener that waited behind another one includes that wait, and the prefix lookup or the reaction's fetch before it, in its `durationMs`. Before, each handler's clock started when its own run began, so a later listener reported a later start and a duration that left out the wait.

A dashboard that charts message or reaction handler latency may show higher durations for listeners that run after another one; those are the times users waited.
