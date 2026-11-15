---
'meocord': minor
---

Each `ValidationIssue` from a `@Validate` schema keeps the issue the schema reported, as `raw`, typed `StandardSchemaV1Issue`. An exception filter can read the library's own fields from it, such as zod's `code` and `minimum`, to word a refusal in the user's language instead of parsing the library's English message. `raw` is non-enumerable, so `toEqual({ message, path })` and a serialised issue are unchanged, and an issue you build yourself has none. See [Validation](https://meocord.dev/docs/4.3/validation).
