// The protocol's version, said by both sides when a client connects. Within a
// major only calls, events and optional fields are added.

export const PROTOCOL_VERSION = "0.8.0";

export function major(version: string): number {
	return Number(version.split(".")[0] ?? "0");
}

/** Whether a client on one version can talk to a server on another. */
export function compatible(client: string, server: string): boolean {
	return major(client) === major(server);
}
