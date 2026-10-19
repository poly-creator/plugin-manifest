import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCssColor, parseThemeMetric, validateThemeJson, THEME_TOKENS } from "./theme.ts";

test("isValidCssColor truth table", () => {
	for (const good of [
		"#fff",
		"#ffff",
		"#7B2CFF",
		"#7B2CFF80",
		"oklch(0.165 0.004 285)",
		"oklch(54.4% 0.276 290.8 / 0.9)",
		"rgb(12 34 56)",
		"rgba(1,2,3,0.5)",
		"hsl(200 50% 40%)",
		"hwb(90 10% 5%)",
		"oklab(0.5 0.1 -0.1)",
		"lch(52 40 260)",
		"transparent",
	])
		assert.equal(isValidCssColor(good), true, good);
	for (const bad of [
		"url(x)",
		"var(--x)",
		"red gradient",
		"calc(1px + 2px)",
		"linear-gradient(red, blue)",
		"javascript:alert(1)",
		"'red'",
		"oklch(0.5 0.2",
	])
		assert.equal(isValidCssColor(bad), false, bad);
});

test("validateThemeJson accepts oklch + hex tokens", () => {
	const r = validateThemeJson({
		appearance: "dark",
		colors: { background: "oklch(0.165 0.004 285)", primary: "#7B2CFF" },
	});
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.theme.appearance, "dark");
		assert.equal(r.theme.colors.background, "oklch(0.165 0.004 285)");
		assert.equal(r.theme.colors.primary, "#7B2CFF");
	}
});

test("unknown tokens warn and drop, not fail", () => {
	const r = validateThemeJson({
		appearance: "light",
		// Unknown token: must type-erase first — the typed colors map only
		// accepts known ThemeToken keys (standalone tsc rejects the literal).
		colors: { background: "#fff", futureToken: "#000" } as unknown as Record<string, string>,
	});
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal((r.theme.colors as unknown as Record<string, string>).futureToken, undefined);
		assert.equal(
			r.warnings.some((w) => w.includes("futureToken")),
			true,
		);
	}
});

test("bad color values are fatal errors", () => {
	const r = validateThemeJson({ appearance: "light", colors: { background: "url(evil)" } });
	assert.equal(r.ok, false);
	if (!r.ok)
		assert.equal(
			r.errors.some((e) => e.includes("background")),
			true,
		);
});

test("shape failures: bad appearance / empty colors / non-object", () => {
	assert.equal(
		validateThemeJson({ appearance: "sepia", colors: { background: "#fff" } }).ok,
		false,
	);
	assert.equal(validateThemeJson({ appearance: "light", colors: {} }).ok, false);
	assert.equal(validateThemeJson("nope").ok, false);
	assert.equal(validateThemeJson(null).ok, false);
});

test("THEME_TOKENS covers the host contract", () => {
	const must = [
		"background",
		"canvas",
		"elevated",
		"primary-foreground",
		"sidebar-ring",
		"chart-5",
		"warning-foreground",
		"halo-1",
		"halo-5",
		"shadow-color",
	];
	for (const t of must) assert.equal((THEME_TOKENS as readonly string[]).includes(t), true, t);
	assert.equal(THEME_TOKENS.length, 46);
});

// --- shape / material tier (v1.5) -------------------------------------------

test("metrics accept in-range lengths and percentages", () => {
	const r = validateThemeJson({
		appearance: "light",
		colors: { background: "#fff" },
		metrics: {
			"radius-md": "12px",
			"radius-2xl": "1rem",
			"surface-blur": "0px",
			"surface-card-alpha": "92%",
		},
	});
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.theme.metrics?.["radius-md"], "12px");
		assert.equal(r.theme.metrics?.["surface-card-alpha"], "92%");
	}
});

test("metrics reject bad syntax and out-of-range values", () => {
	const cases: Array<[string, string]> = [
		["radius-md", "99px"],
		["radius-md", "-4px"],
		["radius-md", "calc(1px + 2px)"],
		["radius-md", "12"],
		["surface-blur", "90px"],
		["surface-card-alpha", "140%"],
		["surface-card-alpha", "0.8"],
	];
	for (const [token, value] of cases) {
		const r = validateThemeJson({
			appearance: "light",
			colors: { background: "#fff" },
			metrics: { [token]: value },
		});
		assert.equal(r.ok, false, `${token}=${value} should be rejected`);
	}
});

test("unknown metrics warn and drop", () => {
	const r = validateThemeJson({
		appearance: "light",
		colors: { background: "#fff" },
		metrics: { "spacing-md": "8px" },
	});
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.theme.metrics, undefined);
		assert.equal(
			r.warnings.some((w) => w.includes("spacing-md")),
			true,
		);
	}
});

test("vibrancy is optional and enum-constrained", () => {
	const ok = validateThemeJson({
		appearance: "dark",
		colors: { background: "#000" },
		vibrancy: "none",
	});
	assert.equal(ok.ok, true);
	if (ok.ok) assert.equal(ok.theme.vibrancy, "none");
	assert.equal(
		validateThemeJson({ appearance: "dark", colors: { background: "#000" }, vibrancy: "sidebar" })
			.ok,
		false,
	);
});

test("parseThemeMetric: rem converts for the range check only", () => {
	assert.equal(parseThemeMetric("radius-2xl", "1rem"), 16);
	assert.equal(parseThemeMetric("radius-2xl", "3rem"), null); // 48px > 40
	assert.equal(parseThemeMetric("surface-card-alpha", "80%"), 80);
});

test("label and extends pass through; bad shapes are rejected", () => {
	const ok = validateThemeJson({
		appearance: "dark",
		colors: { background: "#000" },
		label: "High Contrast",
		extends: "neon-night",
	});
	assert.equal(ok.ok, true);
	if (ok.ok) {
		assert.equal(ok.theme.label, "High Contrast");
		assert.equal(ok.theme.extends, "neon-night");
	}
	const base = { appearance: "light", colors: { background: "#fff" } };
	assert.equal(validateThemeJson({ ...base, label: "" }).ok, false);
	assert.equal(validateThemeJson({ ...base, label: "x".repeat(61) }).ok, false);
	assert.equal(validateThemeJson({ ...base, extends: "has spaces" }).ok, false);
	assert.equal(validateThemeJson({ ...base, extends: "ok:theme.id-1" }).ok, true);
});
