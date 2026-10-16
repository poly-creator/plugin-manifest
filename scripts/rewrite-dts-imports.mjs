#!/usr/bin/env node
// Declaration-file import rewriter for the publishable packages.
//
// Why this exists: `tsc` with `rewriteRelativeImportExtensions` rewrites
// `.ts` → `.js` in the emitted JavaScript, but NOT in the `.d.ts` files it
// emits beside it — a declaration keeps `from "./host.ts"`, which no consumer
// can resolve. Their tsconfig has neither `allowImportingTsExtensions` nor a
// `host.ts` on disk, so a modern consumer gets TS2835 (extensionless) or TS5097
// (`.ts` specifier) depending on `moduleResolution`.
//
// Both the runtime half and the type half of this shipped broken in 0.3.0 and
// were invisible in-repo, because in-repo code resolves through tsconfig
// `paths` → `src/` and never touches `dist/`. It surfaced by installing the
// published tarball into an empty project: `import "@polycreator/plugin-sdk"`
// threw ERR_MODULE_NOT_FOUND, and `tsc --moduleResolution nodenext` refused the
// declarations.
//
// So: a shipped declaration must reference the file that actually ships. This
// rewrites relative specifiers ending in `.ts` to `.js` in `dist/**/*.d.ts` and
// then asserts no TypeScript extension is left in any emitted `.js`/`.d.ts`
// (the invariant that keeps the regression from coming back). Idempotent.
//
// Usage: node scripts/rewrite-dts-imports.mjs <dist-dir> [dist-dir…]
// Wired into the `build` script of packages/plugin-sdk and
// packages/plugin-manifest.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** `.ts`/`.tsx`/`.mts`/`.cts` inside a relative specifier, with its quotes. */
const TS_SPECIFIER = /(["'])(\.{1,2}\/[^"'\n]*?)\.(ts|tsx|mts|cts)\1/g;

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
	console.error("usage: node scripts/rewrite-dts-imports.mjs <dist-dir> [dist-dir…]");
	process.exit(2);
}

/** Recursively collect files whose name ends in one of `exts`. */
function listEmitted(dir, exts) {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listEmitted(full, exts));
		else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
	}
	return out;
}

let rewrittenFiles = 0;
let rewrittenSpecifiers = 0;
const leftovers = [];

for (const dir of dirs) {
	if (!existsSync(dir)) {
		console.error(`rewrite-dts-imports: ${dir} does not exist — build the package first.`);
		process.exit(1);
	}

	for (const file of listEmitted(dir, [".d.ts"])) {
		const before = readFileSync(file, "utf8");
		let count = 0;
		const after = before.replace(TS_SPECIFIER, (_, quote, path) => {
			count += 1;
			return `${quote}${path}.js${quote}`;
		});
		if (after !== before) {
			writeFileSync(file, after);
			rewrittenFiles += 1;
			rewrittenSpecifiers += count;
		}
	}

	// The invariant, checked on every emit (source maps are exempt on purpose:
	// they embed the original source, which legitimately uses `.ts`).
	for (const file of listEmitted(dir, [".js", ".d.ts"])) {
		const match = readFileSync(file, "utf8").match(TS_SPECIFIER);
		if (match) leftovers.push(`${relative(dir, file)}: ${match[0]}`);
	}
}

if (leftovers.length > 0) {
	console.error(
		`rewrite-dts-imports: ${leftovers.length} emitted file(s) still reference a TypeScript extension:\n  - ${leftovers.join(
			"\n  - ",
		)}\n\nA published .js/.d.ts must name the file that ships (.js).`,
	);
	process.exit(1);
}

console.log(
	`rewrite-dts-imports: rewrote ${rewrittenSpecifiers} specifier(s) across ${rewrittenFiles} declaration file(s); no TypeScript extensions left in the emit.`,
);
