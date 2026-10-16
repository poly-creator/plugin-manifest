# @polycreator/plugin-manifest

Shared plugin-manifest validation for the polycreator marketplace.

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
pnpm --filter @polycreator/plugin-manifest build  # tsc → dist/
pnpm --filter @polycreator/plugin-manifest test   # node --test (no vitest)
```

The package must never depend on `vitest` / `@vitejs/plugin-react` /
`@tailwindcss/vite` / `@vitest/*` — the root pnpm override pins those vite
consumers to the desktop's forked vite; this subtree intentionally stays off
it (see the web app README "守则").
