# Contributing to Sabura

Thank you for helping improve Sabura.

## Before making a change

- Open an issue for substantial behavior, schema, or interaction changes.
- Keep the editor offline and self-contained.
- Preserve document compatibility, command IDs, keyboard shortcuts,
  accessibility behavior, and deterministic output unless a change explicitly
  revises their contract.
- Prefer focused changes over unrelated refactoring or new dependencies.

## Development workflow

Use Node.js 22 or later.

```sh
npm ci
npm test
npm run build
git diff --check
```

Commit the generated `sabura.html` whenever its sources change. The build must
remain below the 512 KiB payload-free runtime budget.

Maintainers run `npm run test:e2e:chrome` on macOS before release. Behavioral
changes should include focused regression tests, and user-interface changes
should be checked at desktop and compact viewport sizes.

## Pull requests

Describe the behavior changed, the tests run, and any compatibility or browser
limitations. Do not include generated boards, private documents, or unrelated
experiment artifacts.
