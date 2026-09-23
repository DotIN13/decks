/**
 * Do these one at a time, in order.
 *
 * `Promise.all` is the reflex and it is the wrong one whenever each item is a *subprocess*
 * that touches shared state. The account panel used to read every row's identity that way —
 * one `claude auth status` per account, all at once — and each of those will refresh a stale
 * OAuth token, on the same credentials file every agent session is reading. The CLI
 * serialises a refresh with a lock and tells the losers to come back in a minute, so
 * publishing a list could cost somebody their turn.
 *
 * Here rather than inline because the property is worth a test: a reintroduced `Promise.all`
 * is a one-word change that nothing else would notice.
 */
export async function mapSeries<In, Out>(items: readonly In[], each: (item: In, index: number) => Promise<Out>): Promise<Out[]> {
	const out: Out[] = [];
	for (const [index, item] of items.entries()) out.push(await each(item, index));
	return out;
}
