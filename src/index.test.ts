/**
 * Golden-vector tests — run with `node --test` (no vitest: the web/package
 * subtree must never pull vite). Run via `pnpm test`.
 *
 * Every expectation here mirrors the desktop main-process behavior the shared
 * gate must agree with:
 *   - `isSafePluginId` — loader.ts SAFE_PLUGIN_ID gate.
 *   - `meetsMinVersion` — packages/shared version.ts semantics.
 *   - integrity digest — entryFileOrder + hash == integrity.ts compute order.
 *   - dependency floors — dependencies.ts findMissingPluginDependencies.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	digestEntryFiles,
	findMissingPluginDependencies,
	isSafePluginId,
	meetsMinVersion,
	missingRequiredManifestFields,
	parsePluginManifest,
	MARKETPLACE_MANIFEST_SCHEMA,
	REGISTRY_ENTRY_SCHEMA,
	REGISTRY_SCHEMA,
	isOfficial,
	isPinnedEntry,
	registryLatestZipUrl,
	registryLatestManifestUrl,
	registryPinnedUrl,
} from "./index.ts";

test("isSafePluginId mirrors loader.ts gate", () => {
	// valid: letters, digits, dot, underscore, colon, dash — one segment
	for (const ok of ["hello", "example.audio-node-demo", "my_plugin", "a:b-c", "node.d1.c2"]) {
		assert.equal(isSafePluginId(ok), true, ok);
	}
	// unsafe: path separators, traversal, empty, unicode, spaces
	// NOTE: "." passes the desktop gate too (regex match, no "..") — we mirror
	// it exactly; the plugins-dir join confines it. Only ".." traversal is the
	// escape that must always be caught.
	assert.equal(isSafePluginId(".."), false);
	for (const bad of ["a/b", "a/../b", ".../x", "", "a b", "你", "a\\b", "../etc"]) {
		assert.equal(isSafePluginId(bad), false, JSON.stringify(bad));
	}
});

test("meetsMinVersion mirrors shared/version.ts (numeric compare, no floor)", () => {
	assert.equal(meetsMinVersion("1.10.0", "1.9.0"), true); // numeric, not lexicographic
	assert.equal(meetsMinVersion("1.9.0", "1.10.0"), false);
	assert.equal(meetsMinVersion("1.2.0", "1.2.0"), true);
	assert.equal(meetsMinVersion("0.9.0", "1.0.0"), false);
	// no floor ⇒ always true
	assert.equal(meetsMinVersion("0.0.0", undefined), true);
	assert.equal(meetsMinVersion("0.0.0", ""), true);
	// unparseable floor = no floor; unparseable app = 0.0.0
	assert.equal(meetsMinVersion("1.0.0", "1.0.0-lol"), true);
	assert.equal(meetsMinVersion("abc", "1.0.0"), false);
	// partial triples default missing to 0
	assert.equal(meetsMinVersion("1.5.0", "1"), true);
	assert.equal(meetsMinVersion("1.5.0", "1.5"), true);
	assert.equal(meetsMinVersion("1.5.0", "1.6"), false);
});

test("required fields mirror readPluginManifestFromDir gate", () => {
	assert.deepEqual(missingRequiredManifestFields({ name: "x", version: "1.0.0", main: "m" }), [
		"id",
	]);
	assert.deepEqual(missingRequiredManifestFields({ id: "x", name: "y" }), ["version", "main"]);
	assert.deepEqual(
		missingRequiredManifestFields({ id: "x", name: "y", version: "1.0.0", main: "m.js" }),
		[],
	);
	// empty string is missing
	assert.deepEqual(
		missingRequiredManifestFields({ id: "", name: "y", version: "1.0.0", main: "m.js" }),
		["id"],
	);
});

test("parsePluginManifest shapes + drops junk", () => {
	const m = parsePluginManifest({
		id: "a.b",
		name: "N",
		version: "0.1.0",
		main: "main.js",
		author: "Me",
		trust: "trusted",
		permissions: ["canvas.addNode", 42, "", null],
		categories: ["node", 7],
	});
	assert.ok(m);
	assert.equal(m!.trust, "trusted");
	assert.deepEqual(m!.permissions, ["canvas.addNode"]); // non-strings filtered
	assert.deepEqual(m!.categories, ["node"]);
	assert.equal(parsePluginManifest(null), null);
	assert.equal(parsePluginManifest("x"), null);
	assert.equal(parsePluginManifest({ id: "x" }), null); // missing required
});

test("entryFileOrder is [main, nodeEntry?] — matches integrity.ts iteration", async () => {
	const { entryFileOrder } = await import("./entry-order.ts");
	assert.deepEqual(entryFileOrder({ main: "main.js" }), ["main.js"]);
	assert.deepEqual(entryFileOrder({ main: "main.js", nodeEntry: "node.cjs" }), [
		"main.js",
		"node.cjs",
	]);
});

test("digestEntryFiles == desktop computePluginIntegrity golden vector", async () => {
	// Golden vector computed with node:crypto createHash over [main, nodeEntry]
	// (integrity.ts algorithm): sha256("A" + "B") — verified against the
	// desktop binary in the build check.
	const digest = await digestEntryFiles(
		{ main: "main.js", nodeEntry: "node.cjs" },
		new Map([
			["main.js", new TextEncoder().encode("A")],
			["node.cjs", new TextEncoder().encode("B")],
		]),
	);
	assert.equal(digest, "38164fbd17603d73f696b8b4d72664d735bb6a7c88577687fd2ae33fd6964153");
	// order matters: [node, main] gives a different digest
	const swapped = await digestEntryFiles(
		{ main: "main.js", nodeEntry: "node.cjs" },
		new Map([
			["main.js", new TextEncoder().encode("B")],
			["node.cjs", new TextEncoder().encode("A")],
		]),
	);
	assert.notEqual(swapped, digest);
	// missing declared entry throws
	await assert.rejects(
		digestEntryFiles({ main: "main.js", nodeEntry: "node.cjs" }, new Map()),
		/Missing entry file/,
	);
});

test("dependency floors mirror desktop dependencies.ts", () => {
	const m = { dependencies: { dep: "1.5.0", other: "2.0.0", any: "" } };
	assert.deepEqual(
		findMissingPluginDependencies(m, { dep: "1.6.0", other: "1.0.0", any: "0.0.1" }),
		[{ id: "other", requested: "2.0.0", installedVersion: "1.0.0" }],
	);
	assert.deepEqual(
		findMissingPluginDependencies(m, { dep: "1.6.0", other: "2.0.0", any: "x" }),
		[],
	);
	assert.deepEqual(findMissingPluginDependencies({}, { anything: "1.0.0" }), []);
	assert.deepEqual(findMissingPluginDependencies({ dependencies: { missing: "1.0.0" } }, {}), [
		{ id: "missing", requested: "1.0.0" },
	]);
});

test("marketplace schema: strict semver, enums, caps", () => {
	const ok = {
		id: "example.node-v2-demo",
		name: "Node V2 Demo",
		version: "0.2.1",
		main: "main.js",
		trust: "trusted",
	};
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(ok).success, true);

	// non-numeric semver rejected (version "lol" / "0.1")
	for (const v of ["lol", "0.1", "1", "1.2.3.4", "0.1.0-beta"]) {
		assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, version: v }).success, false, v);
	}
	// unsafe id rejected
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, id: "../evil" }).success, false);
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, id: "a b" }).success, false);
	// >=5 categories rejected
	assert.equal(
		MARKETPLACE_MANIFEST_SCHEMA.safeParse({
			...ok,
			categories: ["a", "b", "c", "d", "e", "f"],
		}).success,
		false,
	);
	assert.equal(
		MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, categories: ["a", "b", "c", "d", "e"] }).success,
		true,
	);
	// trust enum
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, trust: "evil" }).success, false);
	// missing required field (main) rejected
	const { main: _m, ...noMain } = ok;
	assert.equal(MARKETPLACE_MANIFEST_SCHEMA.safeParse(noMain).success, false);
	// path with backslash rejected
	assert.equal(
		MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, main: "src\\main.js" }).success,
		false,
	);
	// unknown keys stripped but NOT rejected (desktop may add extras)
	const withExtra = MARKETPLACE_MANIFEST_SCHEMA.safeParse({ ...ok, someDesktopField: 1 });
	assert.equal(withExtra.success, true);
});

test("REGISTRY_ENTRY_SCHEMA accepts a well-formed latest-mode entry", () => {
	const entry = {
		id: "com.example.my-plugin",
		name: "My Plugin",
		author: "owner",
		repo: "owner/name",
		description: "A demo plugin",
	};
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse(entry).success, true);
	// pinned mode: tag + sha256 together is also well-formed
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...entry, tag: "v0.1.0", sha256: "a".repeat(64) }).success,
		true,
	);
});

test("REGISTRY_ENTRY_SCHEMA rejects bad ids / repos / tags / hashes / pairing", () => {
	const base = {
		id: "com.example.my-plugin",
		name: "My Plugin",
		author: "owner",
		repo: "owner/name",
	};
	// id — safe single path segment (mirrors isSafePluginId)
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, id: "../evil" }).success, false);
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, id: "a b" }).success, false);
	// name / author required, non-empty
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, name: "" }).success, false);
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, author: "" }).success, false);
	const { author: _a, ...noAuthor } = base;
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse(noAuthor).success, false);
	// repo — owner/name, no traversal, no scheme
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, repo: "owner" }).success, false);
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, repo: "owner/na me" }).success, false);
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, repo: "owner/../name" }).success, false);
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, repo: "https://github.com/owner/name" }).success,
		false,
	);
	// tag — must be vX.Y.Z numeric semver
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "0.1.0", sha256: "a".repeat(64) }).success,
		false,
	);
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1", sha256: "a".repeat(64) }).success,
		false,
	);
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1.0-beta", sha256: "a".repeat(64) })
			.success,
		false,
	);
	// sha256 — exactly 64 lowercase hex
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1.0", sha256: "a".repeat(63) }).success,
		false,
	);
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1.0", sha256: "g".repeat(64) }).success,
		false,
	);
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1.0", sha256: "A".repeat(64) }).success,
		false,
	); // uppercase hex rejected — pins stay lowercase
	// pairing — tag without sha256 (and vice versa) rejected
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, tag: "v0.1.0" }).success, false);
	assert.equal(REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, sha256: "a".repeat(64) }).success, false);
	// description — must be ≤ 200 chars
	assert.equal(
		REGISTRY_ENTRY_SCHEMA.safeParse({ ...base, description: "x".repeat(201) }).success,
		false,
	);
});

test("isOfficial derives first-party status from the repo owner", () => {
	// Both namespaces count while the organisation migration is in flight:
	// poly-creator is the destination, bingryan is the historical account whose
	// existing first-party repos a transfer keeps reachable.
	assert.equal(isOfficial({ repo: "poly-creator/plugin-sdk" }), true);
	assert.equal(isOfficial({ repo: "bingryan/color-tag" }), true);
	// A third party cannot claim the badge by lying about its owner.
	assert.equal(isOfficial({ repo: "someone-else/unofficial" }), false);
	assert.equal(isOfficial({ repo: "poly-creator-lookalike/plug" }), false);
	assert.equal(isOfficial({ repo: "notpoly-creator/plug" }), false);
});

test("REGISTRY_SCHEMA wraps entries under schema_version 2", () => {
	const ok = {
		schema_version: 2,
		plugins: [
			{
				id: "com.example.my-plugin",
				name: "My Plugin",
				author: "owner",
				repo: "owner/name",
				added_at: "2026-08-23T00:00:00Z",
			},
		],
	};
	assert.equal(REGISTRY_SCHEMA.safeParse(ok).success, true);
	// schema_version must be exactly 2; unknown versions fail closed
	assert.equal(REGISTRY_SCHEMA.safeParse({ ...ok, schema_version: 1 }).success, false);
	// a bad entry poisons the whole registry
	assert.equal(
		REGISTRY_SCHEMA.safeParse({ ...ok, plugins: [{ ...ok.plugins[0], repo: "nope" }] }).success,
		false,
	);
});

test("URL builders compose latest / pinned GitHub URLs from entry fields", () => {
	const latest = { repo: "owner/name", id: "com.example.my-plugin" };
	assert.equal(
		registryLatestZipUrl(latest),
		"https://github.com/owner/name/releases/latest/download/com.example.my-plugin.zip",
	);
	assert.equal(
		registryLatestManifestUrl("owner/name"),
		"https://github.com/owner/name/releases/latest/download/manifest.json",
	);
	assert.equal(
		registryPinnedUrl({ ...latest, tag: "v0.2.0" }),
		"https://github.com/owner/name/releases/download/v0.2.0/com.example.my-plugin-0.2.0.zip",
	);
	// mode detection: tag presence decides
	assert.equal(isPinnedEntry({ tag: "v0.1.0" }), true);
	assert.equal(isPinnedEntry({}), false);
	assert.equal(isPinnedEntry({ sha256: "a".repeat(64) }), false);
});
