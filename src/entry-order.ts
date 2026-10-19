/**
 * Executable-entry ordering for integrity hashing.
 *
 * The SINGLE SOURCE OF TRUTH for the order in which a plugin's executable
 * files are fed into the SHA-256 used for plugin integrity. Both sides MUST
 * agree on this order:
 *
 *   - desktop  `computePluginIntegrity` (integrity.ts:48) — iterates
 *     `[main, nodeEntry, ...theme.files]`, hashing each file in declaration
 *     order.
 *   - marketplace upload pipeline + registry validator
 *     (`validate-registry.mjs` gate 7) — hash the same entry list in the
 *     same order over the raw bytes.
 *
 * Any divergence (different order, extra file mixed in) silently produces a
 * different digest and breaks install-on-device.
 */

/** The executable/data-surface file order to hash:
 *  `[main?, nodeEntry?, ...theme.files]` — declaration order, falsy skipped. */
export function entryFileOrder(manifest: {
	main?: string;
	nodeEntry?: string;
	theme?: { files: string[] };
}): string[] {
	const order: string[] = [];
	if (manifest.main) order.push(manifest.main);
	if (manifest.nodeEntry) order.push(manifest.nodeEntry);
	for (const file of manifest.theme?.files ?? []) order.push(file);
	return order;
}

/**
 * Compute the SHA-256 hex digest over the bytes of the executable entries, in
 * declaration order. Uses Web Crypto (available in Node ≥ 20 and Workers) so
 * the same function runs in the upload pipeline, pack scripts, and tests.
 *
 * @param entries — the entry files, keyed by their declared path
 *                  (`main` / `nodeEntry` / each of `theme.files`). Missing
 *                  keys throw.
 */
export async function digestEntryFiles(
	manifest: { main?: string; nodeEntry?: string; theme?: { files: string[] } },
	entries: Map<string, Uint8Array>,
): Promise<string> {
	const order = entryFileOrder(manifest);
	const parts: Uint8Array[] = [];
	for (const name of order) {
		const bytes = entries.get(name);
		if (!bytes) throw new Error(`Missing entry file: ${name}`);
		parts.push(bytes);
	}
	const total = parts.reduce((n, p) => n + p.byteLength, 0);
	const buf = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		buf.set(p, off);
		off += p.byteLength;
	}
	const digest = await crypto.subtle.digest("SHA-256", buf);
	return hex(digest);
}

function hex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
