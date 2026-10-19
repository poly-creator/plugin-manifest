/**
 * Theme contribution contract (v1).
 *
 * A theme plugin ships up to 8 `theme.json`-shaped files referenced from the
 * manifest's optional `theme.files` array (a *family*; `theme.json` first is
 * the primary and keeps the plugin id). The files are pure data — no JS, no
 * imports — and their values are injected as CSS custom properties on
 * `html[data-theme="<themeId>"]` by the renderer theme engine.
 *
 * Rules enforced here (shared by the desktop install gate and any future
 * market validation):
 *   - `appearance` is "light" | "dark"; selecting the theme switches the app
 *     mode to its appearance (VSCode `uiTheme` semantics).
 *   - every `colors` key must be a known host token (unknown keys drop with
 *     a warning — forward compatibility).
 *   - every `colors` value must be a plain CSS `<color>` literal verifiable
 *     WITHOUT a DOM: hex, rgb()/rgba(), hsl()/hsla(), hwb(), oklch()/oklab()/
 *     lch()/lab(), color(), or `transparent`. Gradients, url(), var() and
 *     calc() are rejected — `readThemeColor` and the 2D canvas need tokens
 *     that resolve to a single color.
 *
 * This is an authoring lint, not a security boundary: Chromium drops CSS
 * values it cannot parse, so a bad value degrades to the default, never to
 * code execution.
 */
import { z } from "zod";

/** Host CSS custom properties a theme may set, minus the `--` prefix.
 * Kept in lockstep with `:root` / `.dark` in apps/desktop/src/index.css. */
export const THEME_TOKENS = [
	"background",
	"foreground",
	"canvas",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"elevated",
	"elevated-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"success",
	"success-foreground",
	"warning",
	"warning-foreground",
	"info",
	"info-foreground",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
	/* Shape / material tier (v1.5): the 5 stops of the generating-node halo
	 * ring and the tint of every layered shadow. */
	"halo-1",
	"halo-2",
	"halo-3",
	"halo-4",
	"halo-5",
	"shadow-color",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** Non-color host custom properties a theme may set: the shape/material tier.
 *  Kept in lockstep with `:root` in apps/desktop/src/index.css. */
export const THEME_METRICS = [
	"radius-xs",
	"radius-sm",
	"radius-md",
	"radius-lg",
	"radius-xl",
	"radius-2xl",
	"surface-blur",
	"surface-popover-blur",
	"surface-card-alpha",
	"surface-popover-alpha",
] as const;

export type ThemeMetric = (typeof THEME_METRICS)[number];

/** Per-metric validation: a length in px/rem (range-checked) or a percentage. */
const METRIC_KIND: Record<ThemeMetric, { kind: "length" | "percent"; min: number; max: number }> = {
	"radius-xs": { kind: "length", min: 0, max: 40 },
	"radius-sm": { kind: "length", min: 0, max: 40 },
	"radius-md": { kind: "length", min: 0, max: 40 },
	"radius-lg": { kind: "length", min: 0, max: 40 },
	"radius-xl": { kind: "length", min: 0, max: 40 },
	"radius-2xl": { kind: "length", min: 0, max: 40 },
	"surface-blur": { kind: "length", min: 0, max: 60 },
	"surface-popover-blur": { kind: "length", min: 0, max: 60 },
	"surface-card-alpha": { kind: "percent", min: 0, max: 100 },
	"surface-popover-alpha": { kind: "percent", min: 0, max: 100 },
};

const LENGTH_LITERAL = /^(\d+(?:\.\d+)?)(px|rem)$/;
const PERCENT_LITERAL = /^\d{1,3}(?:\.\d+)?%$/;

/** Parse a metric value; returns null when the syntax or the range fails.
 *  `rem` is treated as 16px for the range check only (the value is injected
 *  verbatim). */
export function parseThemeMetric(token: ThemeMetric, value: string): number | null {
	const spec = METRIC_KIND[token];
	const v = value.trim();
	if (spec.kind === "percent") {
		if (!PERCENT_LITERAL.test(v)) return null;
		const n = Number.parseFloat(v);
		return n >= spec.min && n <= spec.max ? n : null;
	}
	const m = LENGTH_LITERAL.exec(v);
	if (!m) return null;
	const n = Number.parseFloat(m[1]) * (m[2] === "rem" ? 16 : 1);
	return n >= spec.min && n <= spec.max ? n : null;
}

/** The parsed, validated shape of a plugin's `theme.json`. */
export interface ThemeDefinition {
	appearance: "light" | "dark";
	/** token name (no `--`) → CSS color literal */
	colors: Partial<Record<ThemeToken, string>>;
	/** shape/material overrides (radius, blur, translucency) */
	metrics?: Partial<Record<ThemeMetric, string>>;
	/** macOS window material. "default" = the under-window vibrancy the app
	 *  ships with; "none" = opaque paper (a flat theme's honest backdrop). */
	vibrancy?: "default" | "none";
	/** Display name for a theme inside a multi-theme plugin family. */
	label?: string;
	/** Base theme id this one extends: another theme shipped by the same or
	 *  another plugin, or a builtin (`builtin-light` / `builtin-dark`).
	 *  Own values win; missing bases degrade to what the theme itself sets. */
	extends?: string;
}

export const THEME_JSON_SCHEMA = z.object({
	appearance: z.enum(["light", "dark"]),
	colors: z.record(z.string().max(64), z.string().max(200)),
	metrics: z.record(z.string().max(64), z.string().max(40)).optional(),
	vibrancy: z.enum(["default", "none"]).optional(),
	label: z.string().trim().min(1).max(60).optional(),
	extends: z
		.string()
		.max(64)
		.regex(/^[A-Za-z0-9._:-]+$/, "extends must name a theme id")
		.optional(),
});

/** The theme id for one file of a plugin. The plugin id stays the id of the
 *  PRIMARY file - the only file of a single-theme plugin, or the one named
 *  `theme.json` in a family - so a base theme's id never moves when a plugin
 *  grows variants and existing `extends` / stored prefs keep resolving. Every
 *  other file is `<pluginId>:<stem>` (basename minus `.json`). */
export function themeIdFor(pluginId: string, file: string, files: readonly string[]): string {
	if (files.length <= 1) return pluginId;
	if (file === "theme.json") return pluginId;
	const stem = (file.split("/").pop() ?? file).replace(/\.json$/i, "");
	return `${pluginId}:${stem}`;
}

/** Human label for a theme: its own `label`, else the plugin name (family
 *  members fall back to `<plugin name> — <stem>`). */
export function themeLabelFor(
	pluginName: string,
	file: string,
	label: string | undefined,
	fileCount: number,
): string {
	if (label) return fileCount > 1 ? `${pluginName} — ${label}` : label;
	if (fileCount <= 1) return pluginName;
	const stem = (file.split("/").pop() ?? file).replace(/\.json$/i, "");
	return `${pluginName} — ${stem}`;
}

// hex (#rgb #rgba #rrggbb #rrggbbaa), the modern color functions (one level
// of nesting for color(--srgb …) args), and `transparent`. Deliberately NOT
// a full CSS parser — see the module docblock.
const COLOR_LITERAL = new RegExp(
	String.raw`^(?:transparent|#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})` +
		String.raw`|(?:rgb|rgba|hsl|hsla|hwb|oklch|oklab|lch|lab|color)\(` +
		String.raw`[a-zA-Z0-9 .,%/()+\-]*\))$`,
);

export function isValidCssColor(value: string): boolean {
	return COLOR_LITERAL.test(value.trim());
}

export type ThemeValidation =
	| { ok: true; theme: ThemeDefinition; warnings: string[] }
	| { ok: false; errors: string[] };

/** Validate a parsed theme.json payload. Unknown tokens warn (dropped);
 *  bad colors or shape error (rejected). */
export function validateThemeJson(raw: unknown): ThemeValidation {
	const parsed = THEME_JSON_SCHEMA.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
		};
	}
	const warnings: string[] = [];
	const errors: string[] = [];
	const colors: Partial<Record<ThemeToken, string>> = {};
	const known = new Set<string>(THEME_TOKENS);
	for (const [key, value] of Object.entries(parsed.data.colors)) {
		if (!known.has(key)) {
			warnings.push(`unknown token "${key}" dropped`);
			continue;
		}
		if (!isValidCssColor(value)) {
			errors.push(`colors.${key}: not a plain CSS color literal ("${value}")`);
			continue;
		}
		colors[key as ThemeToken] = value.trim();
	}
	if (errors.length > 0) return { ok: false, errors };
	if (Object.keys(colors).length === 0) {
		return { ok: false, errors: ["colors: must define at least one known token"] };
	}

	const metrics: Partial<Record<ThemeMetric, string>> = {};
	const knownMetrics = new Set<string>(THEME_METRICS);
	for (const [key, value] of Object.entries(parsed.data.metrics ?? {})) {
		if (!knownMetrics.has(key)) {
			warnings.push(`unknown metric "${key}" dropped`);
			continue;
		}
		const token = key as ThemeMetric;
		if (parseThemeMetric(token, value) === null) {
			const spec = METRIC_KIND[token];
			errors.push(
				`metrics.${key}: expected a ${spec.kind === "percent" ? `percentage 0–${spec.max}%` : `length ${spec.min}–${spec.max}px`}, got "${value}"`,
			);
			continue;
		}
		metrics[token] = value.trim();
	}
	if (errors.length > 0) return { ok: false, errors };

	return {
		ok: true,
		theme: {
			appearance: parsed.data.appearance,
			colors,
			...(Object.keys(metrics).length > 0 ? { metrics } : {}),
			...(parsed.data.vibrancy ? { vibrancy: parsed.data.vibrancy } : {}),
			...(parsed.data.label ? { label: parsed.data.label } : {}),
			...(parsed.data.extends ? { extends: parsed.data.extends } : {}),
		},
		warnings,
	};
}
