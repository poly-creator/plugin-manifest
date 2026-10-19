/**
 * Marketplace manifest schema (zod).
 *
 * The STRICT market-side manifest validation: everything the desktop loader
 * requires (so an approved plugin installs), plus market rules:
 *   - `version` MUST be a numeric semver `X.Y.Z` — the desktop's version
 *     comparison (`meetsMinVersion`) is numeric-per-segment, so a non-numeric
 *     version makes dependency floors and publish ordering ill-defined.
 *   - `trust` is enum-constrained; `permissions` is a bounded string array;
 *     `categories` ≤ 5 (Plan: market rule, not a desktop rule).
 *   - Unknown keys are stripped (the manifest may carry desktop-only extras).
 *
 * Note: `author` is the manifest-declared author string; the marketplace does
 * NOT trust it for attribution — ownership comes from the uploader's session.
 */
import { z } from "zod";
import { SAFE_PLUGIN_ID } from "./safe-id.ts";

const SEMVER = /^\d+\.\d+\.\d+$/;
const ENTRY_PATH = /^[^"<>|:*?\\]+$/; // no drive/global separators; forbids `\`

export const MAX_CATEGORIES = 5;
export const MAX_PERMISSIONS = 64;
/** One plugin's theme family cap (light + dark + high-contrast + variants). */
export const MAX_THEME_FILES = 8;

export const MARKETPLACE_MANIFEST_SCHEMA = z
	.object({
		id: z.string().max(64).regex(SAFE_PLUGIN_ID, "id must be a safe single path segment"),
		name: z.string().trim().min(1).max(80),
		version: z.string().regex(SEMVER, "version must be numeric X.Y.Z semver"),
		author: z.string().max(120).optional(),
		description: z.string().max(800).optional(),
		minAppVersion: z
			.string()
			.regex(SEMVER, "minAppVersion must be numeric X.Y.Z semver")
			.optional(),
		main: z.string().max(200).regex(ENTRY_PATH, "main must be a relative file path").optional(),
		theme: z
			.object({
				files: z
					.array(
						z.string().max(200).regex(ENTRY_PATH, "theme.files entries must be relative paths"),
					)
					.min(1)
					.max(MAX_THEME_FILES),
			})
			.optional(),
		nodeEntry: z
			.string()
			.max(200)
			.regex(ENTRY_PATH, "nodeEntry must be a relative file path")
			.optional(),
		integrity: z.string().optional(),
		dependencies: z.record(z.string().max(64), z.string().max(32)).optional(),
		trust: z.enum(["trusted", "safe"]).optional(),
		permissions: z.array(z.string().trim().min(1).max(80)).max(MAX_PERMISSIONS).optional(),
		categories: z.array(z.string().trim().min(1).max(32)).max(MAX_CATEGORIES).optional(),
		// Unknown keys are stripped (default zod behavior) — the on-disk manifest
		// may carry desktop-only extras; the market validates the shared subset and
		// ignores the rest, like the desktop loader does.
	})
	.superRefine((m, ctx) => {
		if (!m.main && !m.theme) {
			ctx.addIssue({
				code: "custom",
				message: "manifest must declare main (JS entry) or theme.files (data-only theme)",
			});
		}
	});

export type MarketplaceManifest = z.infer<typeof MARKETPLACE_MANIFEST_SCHEMA>;
