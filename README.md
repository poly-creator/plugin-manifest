# @polycreator/plugin-manifest

[![npm](https://img.shields.io/npm/v/%40polycreator%2Fplugin-manifest)](https://www.npmjs.com/package/@polycreator/plugin-manifest)
[![CI](https://github.com/poly-creator/plugin-manifest/actions/workflows/ci.yml/badge.svg)](https://github.com/poly-creator/plugin-manifest/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/provenance-signed-blue?logo=npm)](https://www.npmjs.com/package/@polycreator/plugin-manifest)

Shared plugin-manifest validation for the PolyCreator marketplace.

The desktop main process (`apps/desktop/electron/main/features/plugins/*`)
stays the authority for **install-time** enforcement; this package is the
shared gauge both the market and the pack script use so validation never
drifts. Every rule here is a port of a desktop rule and is golden-vector
tested against it (`src/index.test.ts`, run with `node --test`).

Zero-dependency erasable TS: runs directly under Node 24 type-stripping
(`pnpm test` needs no runner) and bundles into the Workers/Astro app.

## Exports

| Export                                                  | Rule ported from                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `isSafePluginId` / `SAFE_PLUGIN_ID`                     | `loader.ts` — one safe path segment, no `..`                                                 |
| `parsePluginManifest` / `missingRequiredManifestFields` | `loader.ts` readPluginManifestFromDir gate (`id`, `name`, `version`, `main`)                 |
| `entryFileOrder` / `digestEntryFiles`                   | `integrity.ts:48` — hash input order is `[main, nodeEntry?]`, Web Crypto SHA-256             |
| `meetsMinVersion`                                       | `packages/shared/version.ts` — numeric-triple compare, missing floor = no floor              |
| `findMissingPluginDependencies`                         | `dependencies.ts` — dep floor resolution                                                     |
| `MARKETPLACE_MANIFEST_SCHEMA` (zod)                     | market-only strict layer: numeric `X.Y.Z` semver, trust enum, permissions ≤64, categories ≤5 |

## Layout

- `src/index.ts` — re-exports
- `src/safe-id.ts`, `src/manifest.ts`, `src/version.ts`, `src/entry-order.ts`,
  `src/dependencies.ts`, `src/schema.ts`

## Development

```bash
pnpm install
pnpm run build   # tsc → dist/
pnpm test        # node --test (no test framework)
```

Deliberately dependency-free: no test framework, no bundler, no React. The
marketplace imports this as source and lets its own bundler inline it, while the
registry validator and plugin authors consume the compiled `dist/` — so a
toolchain dependency here would propagate into all of them.
