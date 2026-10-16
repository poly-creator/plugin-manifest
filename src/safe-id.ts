/**
 * Plugin id safety gate.
 *
 * Ported verbatim from the desktop main process
 * (`apps/desktop/electron/main/features/plugins/loader.ts`) — the marketplace
 * upload pipeline must enforce the SAME id rules the desktop install gate
 * enforces, or a plugin the market approves could be rejected (or worse,
 * mishandled) on-device. Keep the two in lockstep.
 *
 * A plugin id must be a safe single path segment — no separators or `..`, so a
 * hand-crafted id can never escape `userData/plugins/` when the desktop joins
 * it into a disk path.
 */

export const SAFE_PLUGIN_ID = /^[A-Za-z0-9._:-]+$/;

/** True when `id` is a valid plugin id: one safe path segment, no `..`. */
export function isSafePluginId(id: string): boolean {
	return SAFE_PLUGIN_ID.test(id) && !id.includes("..");
}
