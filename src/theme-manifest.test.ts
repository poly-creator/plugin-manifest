import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MARKETPLACE_MANIFEST_SCHEMA,
	digestEntryFiles,
	entryFileOrder,
	missingRequiredManifestFields,
	parsePluginManifest,
	themeIdFor,
	themeLabelFor,
} from "./index.ts";

const base = { id: "neon-night", name: "Neon Night", version: "1.0.0" };

test("manifest with theme.files and no main is valid", () => {
	const m = { ...base, theme: { files: ["theme.json"] } };
	assert.deepEqual(missingRequiredManifestFields(m), []);
	const parsed = MARKETPLACE_MANIFEST_SCHEMA.safeParse(m);
	assert.equal(parsed.success, true);
	assert.deepEqual(parsePluginManifest(m)?.theme?.files, ["theme.json"]);
});

test("a theme family (multiple files) is valid and capped", () => {
	const family = { ...base, theme: { files: ["night.json", "contrast.json"] } };
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(family).success, true);
	assert.deepEqual(parsePluginManifest(family)?.theme?.files, ["night.json", "contrast.json"]);
	const tooMany = { ...base, theme: { files: Array.from({ length: 9 }, (_, i) => `t${i}.json`) } };
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(tooMany).success, false);
	const empty = { ...base, theme: { files: [] } };
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(empty).success, false);
	assert.deepEqual(missingRequiredManifestFields(empty), ["main"]);
});

test("the old single-file `theme.file` shape is no longer accepted", () => {
	const legacyTheme = { ...base, theme: { file: "theme.json" } };
	assert.deepEqual(missingRequiredManifestFields(legacyTheme), ["main"]);
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(legacyTheme).success, false);
	assert.equal(parsePluginManifest(legacyTheme)?.theme, undefined);
});

test("manifest with neither main nor theme.files is rejected", () => {
	assert.deepEqual(missingRequiredManifestFields(base), ["main"]);
	const parsed = MARKETPLACE_MANIFEST_SCHEMA.safeParse(base);
	assert.equal(parsed.success, false);
});

test("legacy manifest with main and no theme stays valid", () => {
	const m = { ...base, main: "main.js" };
	assert.deepEqual(missingRequiredManifestFields(m), []);
	assert.equal(parsePluginManifest(m)?.main, "main.js");
});

test("entryFileOrder: [main?, nodeEntry?, ...theme.files]", () => {
	assert.deepEqual(
		entryFileOrder({
			main: "main.js",
			nodeEntry: "node.cjs",
			theme: { files: ["a.json", "b.json"] },
		}),
		["main.js", "node.cjs", "a.json", "b.json"],
	);
	assert.deepEqual(entryFileOrder({ theme: { files: ["theme.json"] } }), ["theme.json"]);
	assert.deepEqual(entryFileOrder({ main: "main.js" }), ["main.js"]);
});

test("digestEntryFiles covers every theme file in order", async () => {
	const enc = (s: string) => new TextEncoder().encode(s);
	const manifest = { main: "main.js", theme: { files: ["theme.json"] } };
	const digest = await digestEntryFiles(
		manifest,
		new Map([
			["main.js", enc("A")],
			["theme.json", enc("T")],
		]),
	);
	// golden: sha256("A" + "T")
	assert.equal(digest, "eb5442705969dc8da5dfac8f9658dc68acdab5bb7635ba7cc551e389416ac34e");

	// A family hashes BOTH files, in declaration order.
	const family = { theme: { files: ["a.json", "b.json"] } };
	const famDigest = await digestEntryFiles(
		family,
		new Map([
			["a.json", enc("A")],
			["b.json", enc("B")],
		]),
	);
	assert.equal(
		famDigest,
		await digestEntryFiles(
			family,
			new Map([
				["b.json", enc("B")],
				["a.json", enc("A")],
			]),
		),
	);
	const reordered = await digestEntryFiles(
		{ theme: { files: ["b.json", "a.json"] } },
		new Map([
			["a.json", enc("A")],
			["b.json", enc("B")],
		]),
	);
	assert.notEqual(famDigest, reordered);
});

test("digestEntryFiles throws on a missing theme file", async () => {
	await assert.rejects(
		digestEntryFiles({ theme: { files: ["theme.json"] } }, new Map()),
		/Missing entry file/,
	);
});

// --- id + label derivation (one implementation, shared by main + tooling) ----

test("themeIdFor keeps the primary file's id stable and namespaces the rest", () => {
	const single = ["theme.json"];
	assert.equal(themeIdFor("neon-night", "theme.json", single), "neon-night");
	// Growing a family must NOT move the base id: `extends` and stored prefs
	// that already name the plugin keep resolving.
	const family = ["theme.json", "high-contrast.json"];
	assert.equal(themeIdFor("neon-night", "theme.json", family), "neon-night");
	assert.equal(themeIdFor("neon-night", "high-contrast.json", family), "neon-night:high-contrast");
	const deep = ["theme.json", "a.json", "themes/contrast.json"];
	assert.equal(themeIdFor("neon-night", "themes/contrast.json", deep), "neon-night:contrast");
	// A family with no `theme.json` namespaces every file.
	assert.equal(
		themeIdFor("neon-night", "night.json", ["night.json", "day.json"]),
		"neon-night:night",
	);
});

test("themeLabelFor prefers the theme's own label", () => {
	assert.equal(themeLabelFor("Neon Night", "theme.json", undefined, 1), "Neon Night");
	assert.equal(themeLabelFor("Neon Night", "theme.json", "Noir", 1), "Noir");
	assert.equal(themeLabelFor("Neon Night", "night.json", undefined, 2), "Neon Night — night");
	assert.equal(
		themeLabelFor("Neon Night", "contrast.json", "High Contrast", 2),
		"Neon Night — High Contrast",
	);
});
