/**
 * Canonical marketplace plugin manifest type + required-field checks.
 *
 * The manifest shape mirrors the desktop's `ExternalPluginManifest`
 * (`apps/desktop/electron/main/features/plugins/types.ts`) — a marketplace
 * plugin's `manifest.json` IS a desktop plugin manifest, plus the strict
 * semver/numbered-version rule from the marketplace schema.
 */

/** A plugin manifest as parsed from `manifest.json`. Structurally identical to
 *  the desktop's `ExternalPluginManifest`; the marketplace adds strict version
 *  validation (see `MARKETPLACE_MANIFEST_SCHEMA`). */
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	minAppVersion?: string;
	/** Renderer entry: built ESM served via `polycreator-plugin://<id>/<main>`.
	 *  Required UNLESS `theme` is declared (data-only theme plugin). */
	main?: string;
	/** Optional main-process entry for provider/job backends (V1.2). */
	nodeEntry?: string;
	/** Theme contribution (v1): pure-data color themes, no JS. Declaring it
	 *  makes `main` optional. One plugin may ship up to 8 themes (a family:
	 *  light + dark + high contrast); their ids derive from the plugin id
	 *  (see themeIdFor). */
	theme?: { files: string[] };
	/** Content hash of the plugin's executable surface (`main` + `nodeEntry`
	 *  files) — verified by the desktop main process at enable/install. On the
	 *  marketplace this field is IGNORED on upload: the server computes the hash
	 *  from the actual uploaded bytes and writes the authoritative value. */
	integrity?: string;
	/** Plugin dependency graph: dep plugin id → minimum version floor. */
	dependencies?: Record<string, string>;
	trust?: "trusted" | "safe";
	permissions?: string[];
	categories?: string[];
}

/** Fields the desktop loader treats as required for a plugin to be installable
 *  (port of `readPluginManifestFromDir`'s gate). The marketplace enforces the
 *  same set — a plugin that would be rejected on-device must be rejected here. */
export const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version"] as const;

/** Returns the list of required fields missing from `manifest` (empty = valid). */
export function missingRequiredManifestFields(manifest: Record<string, unknown>): string[] {
	const missing: string[] = REQUIRED_MANIFEST_FIELDS.filter((f) => {
		const v = manifest[f];
		return typeof v !== "string" || v.length === 0;
	});
	const hasMain = typeof manifest.main === "string" && (manifest.main as string).length > 0;
	const theme = manifest.theme as Record<string, unknown> | undefined;
	const themeFiles = theme?.files;
	const hasTheme =
		Array.isArray(themeFiles) &&
		themeFiles.length > 0 &&
		themeFiles.every((f) => typeof f === "string" && f.length > 0);
	if (!hasMain && !hasTheme) missing.push("main");
	return missing;
}

/** Parse + shape-check a manifest.json payload into a typed manifest.
 *  Returns `null` when a required field is missing or types are wrong —
 *  a malformed manifest is rejected, not partially accepted. */
export function parsePluginManifest(raw: unknown): PluginManifest | null {
	if (typeof raw !== "object" || raw === null) return null;
	const m = raw as Record<string, unknown>;
	if (missingRequiredManifestFields(m).length > 0) return null;
	const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
	return {
		id: m.id as string,
		name: m.name as string,
		version: m.version as string,
		main: str(m.main),
		theme: (() => {
			const t = m.theme as Record<string, unknown> | undefined;
			if (typeof t !== "object" || t === null || !Array.isArray(t.files)) return undefined;
			const files = t.files.filter((f): f is string => typeof f === "string" && f.length > 0);
			return files.length > 0 ? { files } : undefined;
		})(),
		author: str(m.author),
		description: str(m.description),
		minAppVersion: str(m.minAppVersion),
		nodeEntry: str(m.nodeEntry),
		integrity: str(m.integrity),
		dependencies:
			typeof m.dependencies === "object" && m.dependencies !== null
				? (m.dependencies as Record<string, string>)
				: undefined,
		trust: m.trust === "trusted" || m.trust === "safe" ? m.trust : undefined,
		permissions: Array.isArray(m.permissions)
			? m.permissions.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
			: undefined,
		categories: Array.isArray(m.categories)
			? m.categories.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
			: undefined,
	};
}
