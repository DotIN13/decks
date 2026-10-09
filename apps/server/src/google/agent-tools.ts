import { GDOCS_TOOLS } from "./docs.ts";

/**
 * The agents' Google Docs tools, for a runtime in this process (Claude, Pi): a call goes to this
 * server's own `/api/gdocs/call` with the agent's canvas token, exactly as opencode's and
 * antigravity's tools do from outside, so every runtime is answered by one route with one identity.
 */

export { GDOCS_TOOLS };

export type GdocsCall = (tool: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

export function gdocsCaller(port: number, token: string | undefined): GdocsCall {
	return async (tool, args) => {
		if (!token) return { text: "This agent has no canvas token, so it cannot reach Google Docs.", isError: true };
		try {
			const response = await fetch(`http://127.0.0.1:${port}/api/gdocs/call`, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
				body: JSON.stringify({ tool, args }),
			});
			return (await response.json()) as { text: string; isError: boolean };
		} catch (error) {
			return { text: `Decks could not be reached: ${(error as Error).message}`, isError: true };
		}
	};
}
