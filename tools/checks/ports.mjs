// A check's ports, free before its programs start: a slot is free the moment the last caller let it
// go, but that caller's programs may still be closing their ports, so the next one waits for them.
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";

/** Whether a program could listen on the port now, as the server will (127.0.0.1). */
export const canListen = (port, host = "127.0.0.1") =>
	new Promise((done) => {
		const probe = createServer();
		probe.once("error", () => done(false));
		probe.listen(port, host, () => probe.close(() => done(true)));
	});

/** Who listens on the port, for the refusal: "pid 123 (node)", or nothing known. */
function holder(port) {
	try {
		const pid = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim().split("\n")[0];
		const name = pid ? execFileSync("ps", ["-o", "comm=", "-p", pid], { encoding: "utf8" }).trim() : "";
		return pid ? `pid ${pid}${name ? ` (${name})` : ""}` : "nothing known";
	} catch {
		return "nothing known";
	}
}

/** Wait until every port is free, up to ms; a port still held then is refused, naming its holder. */
export async function portsFree(ports, { ms = 20_000, every = 100 } = {}) {
	const end = Date.now() + ms;
	for (;;) {
		const held = [];
		for (const port of ports) if (!(await canListen(port))) held.push(port);
		if (!held.length) return;
		if (Date.now() >= end) throw new Error(`port ${held.join(", ")} is in use after ${Math.round(ms / 1000)} s: ${held.map((p) => `${p} by ${holder(p)}`).join("; ")}`);
		await new Promise((r) => setTimeout(r, every));
	}
}
