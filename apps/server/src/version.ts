import { execFileSync } from "node:child_process";

/** The commit this harness runs, short, read once; "" when it is not a git checkout. */
let version: string | undefined;
export function harnessVersion(): string {
	if (version !== undefined) return version;
	try {
		version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.env.DECKS_APP_DIR ?? process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		version = "";
	}
	return version;
}
