# TypeScript 7 Adoption Plan

Status: Deferred

This remains a parallel, gated toolchain track in the
[current development roadmap](./development-roadmap.md), not a dependency of
the gameplay phase sequence.

## Objective

Adopt the native TypeScript 7 compiler for project type-checking without
dropping the existing ESLint, Next.js, React, accessibility, or
TypeScript-specific lint coverage.

## Why this needs a transition setup

TypeScript 7.0 does not expose the JavaScript compiler API consumed by
`typescript-eslint`. TypeScript 7.1 is expected to introduce a replacement API,
but until the surrounding tooling supports it, the official transition path is
to run TypeScript 7 as the command-line compiler while exposing the TypeScript 6
compatibility API to tools such as ESLint.

Relevant upstream guidance:

- [TypeScript 7.0: running side-by-side with TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60)
- [typescript-eslint supported dependency versions](https://typescript-eslint.io/users/dependency-versions/)

## Proposed dependency layout

At implementation time, re-check the latest compatible patch versions before
changing the lockfile.

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.2"
  }
}
```

This layout intentionally gives the packages different responsibilities:

- `@typescript/native` supplies the TypeScript 7 `tsc` executable.
- The package named `typescript` supplies the TypeScript 6 programmatic API
  expected by `typescript-eslint`, Next.js, and other JavaScript tooling.

## Proposed scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "typecheck:ts6": "tsc6 --noEmit"
  }
}
```

- `npm run typecheck` is the normal TypeScript 7 validation gate.
- `npm run typecheck:ts6` is a temporary compatibility comparison and rollback
  aid. It can be removed once the ecosystem has moved to the TypeScript 7 API.

## Implementation steps

1. Create a `codex/*` branch because this changes the project toolchain and CI
   contract.
2. Re-check the current TypeScript 7, `@typescript/typescript6`,
   `typescript-eslint`, `eslint-config-next`, Vinext, and Next.js compatibility
   notes.
3. Replace the single TypeScript dependency with the two-package alias layout.
4. Regenerate `package-lock.json` with Node.js 24.19.0.
5. Confirm that `node_modules/.bin/tsc` resolves to TypeScript 7 and
   `node_modules/.bin/tsc6` resolves to the TypeScript 6 compatibility package.
6. Confirm that importing the package named `typescript` exposes the TypeScript
   6 API used by ESLint.
7. Run the full verification matrix below.
8. Open a pull request that documents the temporary dual-toolchain rationale
   and its removal condition.

## Verification matrix

All checks must pass locally and in GitHub Actions:

```text
node --version
npm ci
npm run typecheck
npm run typecheck:ts6
npm run lint
npm run test:unit
npm run build
graphify update .
```

Additional acceptance checks:

- TypeScript 7 and TypeScript 6 report no project errors.
- ESLint retains the existing Next.js, React, React Hooks, accessibility, and
  TypeScript rule sets.
- The production build remains Cloudflare Workers/Sites compatible.
- Deterministic simulation tests remain unchanged and passing.
- No runtime module imports TypeScript or depends on the compiler selection.

## Risks and mitigations

### Divergent compiler diagnostics

TypeScript 7 may intentionally differ from TypeScript 6. Keep the temporary
`typecheck:ts6` comparison until the team is comfortable with those
differences. Treat TypeScript 7 as the authoritative gate once the rollout is
accepted.

### Tooling resolves the wrong package

Some tools import the package named `typescript`, while command scripts resolve
executables from `node_modules/.bin`. Verify both paths explicitly after every
dependency refresh.

### Future dependency updates undo the alias arrangement

Document the alias rationale in the pull request and keep exact versions in the
lockfile. Review Dependabot changes to either TypeScript package carefully.

### TypeScript 7-only syntax is not understood by ESLint

Until `typescript-eslint` supports the TypeScript 7 API, avoid adopting syntax
that the TypeScript 6 parser cannot read. Revisit this constraint when
TypeScript 7.1 and compatible parser releases are available.

## Rollback

If CI, editor integration, Vinext, or Sites builds regress:

1. Remove `@typescript/native`.
2. Restore `"typescript": "6.0.3"` or the latest verified TypeScript 6 patch.
3. Remove `typecheck:ts6`.
4. Regenerate the lockfile and rerun the full verification matrix.

## Exit condition

Remove the dual-toolchain setup when TypeScript exposes its stable replacement
compiler API and the project’s versions of `typescript-eslint`,
`eslint-config-next`, Next.js, and Vinext officially support it. At that point,
return to a single TypeScript dependency and run the same verification matrix.

## Longer-term alternative

Evaluate Oxlint separately if faster, TypeScript 7-native linting is valuable.
That effort should audit rule parity for the project’s current Next.js, React,
React Hooks, accessibility, import, and TypeScript rules before replacing
ESLint. It should not be bundled into the initial TypeScript 7 compiler rollout.
