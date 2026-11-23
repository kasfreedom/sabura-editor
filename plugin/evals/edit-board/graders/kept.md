---
type: regex
target: { source: file, path: checkout-v2.html }
pattern: '"id":"cart".*"text":"Cart"|"text":"Cart".*"id":"cart"'
---
The original Cart step is still there with its ID, so the edit kept the
user's board instead of redrawing it.
