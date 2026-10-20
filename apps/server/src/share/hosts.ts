import { isIP } from "node:net";

/**
 * Which names this server answers to, against DNS rebinding.
 *
 * A page on any site can point a name it owns at 127.0.0.1 after the page has loaded, and the
 * browser then calls this server as if it were that site's own: same-origin, no `Origin` to
 * check, no pairing token asked (`pairing.ts`). What it cannot change is the `Host` it sends,
 * which is still the attacker's name. So a request is answered only when it was addressed to a
 * name that can only mean this server: an IP address, `localhost`, a tailnet name (`*.ts.net`),
 * the name the server was told to listen on, or a name the owner lists in `DECKS_HOSTS`.
 *
 * No `Host` at all is not a browser (every browser sends one), and is let through.
 */

/** The names besides the built-in ones: `DECKS_HOSTS`, comma-separated, and the bind host when it is a name. */
export function extraHosts(env: NodeJS.ProcessEnv = process.env, bind?: string): string[] {
	const names = String(env.DECKS_HOSTS ?? "")
		.split(",")
		.map((one) => one.trim().toLowerCase().replace(/\.$/, ""))
		.filter(Boolean);
	if (bind && !isIP(bind.replace(/^\[|\]$/g, "")) && bind !== "localhost") names.push(bind.toLowerCase());
	return names;
}

/** The name in a `Host` header, without its port or brackets; undefined when it does not parse. */
export function hostName(host: string): string | undefined {
	const value = host.trim().toLowerCase();
	const bracketed = /^\[([0-9a-f:.%a-z]+)\](?::\d+)?$/.exec(value);
	if (bracketed) return isIP(bracketed[1]!) === 6 ? bracketed[1] : undefined;
	const plain = /^([a-z0-9._-]+?)\.?(?::\d+)?$/.exec(value);
	return plain?.[1];
}

/**
 * Whether a request addressed to this `Host` may be answered. A name in `extra` matches itself;
 * one written `*.example.com` or `.example.com` matches every name under it.
 */
export function hostAllowed(host: string | string[] | undefined, extra: readonly string[] = []): boolean {
	if (host === undefined || host === "") return true;
	if (Array.isArray(host)) return host.every((one) => hostAllowed(one, extra));
	const name = hostName(host);
	if (!name) return false;
	if (isIP(name)) return true;
	if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".ts.net")) return true;
	return extra.some((one) => {
		const suffix = one.startsWith("*.") ? one.slice(1) : one.startsWith(".") ? one : undefined;
		return suffix ? name.endsWith(suffix) : name === one;
	});
}

/** What a refused request is told. */
export function hostRefusal(host: string | string[] | undefined): string {
	const name = (typeof host === "string" ? hostName(host) : undefined) ?? String(host);
	return `Decks does not answer to the name ${name}. If this is your own name for this server, add it to DECKS_HOSTS (comma-separated) in the server's environment and start it again.`;
}
