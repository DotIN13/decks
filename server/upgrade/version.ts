// The deck's version in .decks/migrations.json, read and written as today's server does,
// through the kernel's raw record of that one file (a hidden path, which a Deck refuses).
import type { VersionFile } from "../kernel/index.ts";

export type Semver = string;
export type { VersionFile };

export function parseSemver(version: unknown): [number, number, number] | undefined {
	const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function compareSemver(a: Semver, b: Semver): number {
	const x = parseSemver(a) ?? [0, 0, 0];
	const y = parseSemver(b) ?? [0, 0, 0];
	return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export type Record = { version?: unknown; [migration: string]: unknown };

export async function readRecord(file: VersionFile): Promise<Record> {
	try {
		const parsed = JSON.parse((await file.read()) ?? "{}") as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record) : {};
	} catch {
		return {};
	}
}

export async function writeVersion(file: VersionFile, version: Semver, more: Record = {}): Promise<void> {
	const record = { ...(await readRecord(file)), ...more, version };
	await file.write(`${JSON.stringify(record, null, "\t")}\n`);
}

/** A version file in memory, for tests and for a deck with no folder. */
export function memoryVersion(text?: string): VersionFile & { text?: string } {
	const file: VersionFile & { text?: string } = { ...(text ? { text } : {}), read: async () => file.text, write: async (next) => void (file.text = next) };
	return file;
}
