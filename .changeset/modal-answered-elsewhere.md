---
'meocord': patch
---

A modal Discord refuses as already acknowledged (40060) now leaves the interaction answered, as a refused reply or update does, so the next `respond().send()` edits the answer that was made elsewhere instead of failing the same way.
