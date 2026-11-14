import { readFileSync } from "node:fs";

// The tokens decks login kept, by server address.

export function tokensFromFile(file: string): Record<string, string> {
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return saved && typeof saved === "object" ? (saved as Record<string, string>) : {};
	} catch {
		return {};
	}
}
