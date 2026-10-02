---
'meocord': patch
---

A modal's file upload field reaches the handler's params as an array of the uploaded `Attachment`s, the ones `interaction.fields.getUploadedFiles()` gives. It gave the attachments' ids. For a bot upgrading from an earlier 4.1 beta, a handler that read ids from the field takes them from the attachments: `files.map(file => file.id)`.

`createModalFields` takes an array of `Attachment`s for a file upload field, so a test can submit one: `createModalFields({ screenshot: [attachment] })`.
