/**
 * @polycreator/plugin-manifest
 *
 * Shared plugin-manifest validation for the polycreator marketplace.
 * Zero-dependency-era erasable TS: pure functions + a zod schema; runs under
 * Node 24 type-stripping and bundles into the Workers/Astro app.
 *
 * The desktop main process (`apps/desktop/electron/main/features/plugins/*`)
 * remains the authority for install-time enforcement; this package is the
 * shared gauge both the market and the desktop (re)use so validation never
 * drifts apart.
 */
export * from "./safe-id.ts";
export * from "./version.ts";
export * from "./manifest.ts";
export * from "./entry-order.ts";
export * from "./dependencies.ts";
export * from "./schema.ts";
export * from "./theme.ts";
export * from "./registry.ts";
