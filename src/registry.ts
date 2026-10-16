/**
 * Registry schema (zod) — the plugin registry's manifest format, v2.
 *
 * A registry repo holds one `plugins.json` describing every plugin; where it
 * lives is the consumer's configuration, not this package's knowledge. v2 is
 * the Obsidian-style shape: entries are
 * REPO-level (one plugin = one repo = one `releases/latest`), so publishing
 * a new version is just the author pushing a tag — no registry PR per
 * release. This schema is the single source of truth for its shape, shared
 * by the registry repo's verify.yml, `apps/web` catalog aggregation, and the
 * desktop marketplace.
 *
 * Design invariants (plan decision record):
 *   - Two modes per entry:
 *       latest (default) — no `tag`, no `sha256`. Download URL is
 *         `releases/latest/download/<id>.zip`, constructible without an API
 *         call because the author's release workflow uploads versionless
 *         alias assets (`<id>.zip` + `manifest.json`). Trust = PR review +
 *         the in-zip `manifest.integrity`.
 *       pinned — `tag` + `sha256` together (both or neither). Downloads the
 *         exact `<id>-<version>.zip` asset and byte-verifies the pin; for
 *         review-critical entries that must never move.
 *   - Download URLs are composed at read time, never stored.
 *   - `asset` filenames are NOT stored: latest mode uses the alias
 *     convention, pinned mode derives `<id>-<version>.zip` from the tag.
 *   - First-party (`official`) status is derived from the repo owner
 *     (`repo.startsWith("bingryan/")`); see {@link isOfficial}. Not stored,
 *     so third-party entries can't claim the badge by accident.
 */
import { z } from "zod";
import { SAFE_PLUGIN_ID } from "./safe-id.ts";

/** GitHub `owner/name` — no leading/trailing slash, no path traversal. */
const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Release tags are `v` + numeric semver (`v0.1.0`), matching the template's
 * `release.yml` tag trigger and the pack CLI's `<id>-<version>.zip` naming. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** Pinned zip digest — exactly 64 lowercase hex chars. */
const SHA256_HEX = /^[a-f0-9]{64}$/;

/** One registry entry — one plugin repo, in latest or pinned mode.
 *
 * Field set is intentionally Obsidian-parsimonious (the registry describes
 * which GitHub repos host plugins, nothing more):
 *   - id / name / author / repo: identifying four
 *   - description: one-line tagline (long content lives in the repo's README)
 *   - tag + sha256: optional, paired (both or neither) — exact pin to one
 *     reviewed release for review-critical entries; absent = latest mode
 *
 * First-party marker is derived (see {@link isOfficial}), not stored. */
export const REGISTRY_ENTRY_SCHEMA = z
	.object({
		id: z.string().max(64).regex(SAFE_PLUGIN_ID, "id must be a safe single path segment"),
		name: z.string().trim().min(1).max(100),
		author: z.string().trim().min(1).max(100),
		repo: z.string().regex(GITHUB_REPO, "repo must be owner/name"),
		description: z.string().trim().max(200).optional(),
		/** Pinned mode: exact release tag. Must pair with `sha256`. */
		tag: z.string().regex(RELEASE_TAG, "tag must be vX.Y.Z").optional(),
		/** Pinned mode: sha256 of the `<id>-<version>.zip` asset. Must pair with `tag`. */
		sha256: z.string().regex(SHA256_HEX, "sha256 must be 64 lowercase hex chars").optional(),
	})
	.refine((e) => (e.tag === undefined) === (e.sha256 === undefined), {
		message: "tag and sha256 must both be present (pinned) or both absent (latest)",
	});

export type RegistryEntry = z.infer<typeof REGISTRY_ENTRY_SCHEMA>;

/** The whole registry file: a schema version + the entry list. */
export const REGISTRY_SCHEMA = z.object({
	schema_version: z.literal(2),
	plugins: z.array(REGISTRY_ENTRY_SCHEMA),
});

export type RegistryManifest = z.infer<typeof REGISTRY_SCHEMA>;

/** True when the entry pins an exact release (tag + sha256), false for
 * `releases/latest` mode. The one place the mode decision is made. */
export function isPinnedEntry(entry: { tag?: unknown; sha256?: unknown }): boolean {
	return typeof entry.tag === "string";
}

/** First-party derivation: any entry whose repo lives under the `bingryan/`
 * GitHub org is PolyCreator-maintained. Derived at read time so third-party
 * entries cannot claim `official` status by lying in the registry file. */
export function isOfficial(entry: { repo: string }): boolean {
	return entry.repo.startsWith("bingryan/");
}

/**
 * Install URL for latest-mode entries: the versionless alias asset uploaded
 * by the author's release workflow (`release/<id>.zip`). CDN redirect, no
 * API call, no rate limit, always the newest full (non-prerelease) release.
 */
export function registryLatestZipUrl(entry: { repo: string; id: string }): string {
	return `https://github.com/${entry.repo}/releases/latest/download/${entry.id}.zip`;
}

/**
 * Version-probe URL: the versionless `manifest.json` alias asset — the exact
 * integrity-injected manifest bytes that ship inside the zip. One GET tells
 * the desktop the latest version (and permissions) without the GitHub API.
 */
export function registryLatestManifestUrl(repo: string): string {
	return `https://github.com/${repo}/releases/latest/download/manifest.json`;
}

/**
 * Install URL for pinned-mode entries: the versioned asset name derived from
 * the tag (`<id>-<version>.zip`, the pack CLI's canonical output). Only
 * meaningful together with the entry's `sha256` pin.
 */
export function registryPinnedUrl(entry: { repo: string; id: string; tag: string }): string {
	const version = entry.tag.replace(/^v/, "");
	return `https://github.com/${entry.repo}/releases/download/${entry.tag}/${entry.id}-${version}.zip`;
}
