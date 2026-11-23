---
type: regex
target: { source: file, path: checkout-v2.html }
pattern: '"id":\s*"cart"[\s\S]{0,600}?"text":\s*"Cart"'
---
The original Cart step is still there with its ID, so the edit kept the
user's board instead of redrawing it.
