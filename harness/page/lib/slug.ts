/*
 * Turns a typed name into a slug, so a field can show what the name will become. Only a
 * preview: what is sent is the typed name, and the server decides.
 */
export const MAX_WORKSPACE_LENGTH = 24;

export function slug(raw: string, max: number): string {
	const slugged = raw
		.normalize("NFC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	if (slugged.length <= max) return slugged;
	const cut = slugged.slice(0, max);
	const boundary = cut.lastIndexOf("-");
	return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/g, "");
}

/** What a typed workspace name becomes on the server; empty when nothing would survive. */
export function workspaceSlug(raw: string): string {
	return slug(raw, MAX_WORKSPACE_LENGTH);
}
