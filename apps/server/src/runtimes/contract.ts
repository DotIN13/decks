import type { AgentCapabilities, AgentKind, SlashCommand } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext } from "../agents/backend.ts";

/**
 * What a runtime is, declared once, by itself.
 *
 * Four things were written down in four different places before this existed, and none of
 * them was next to the runtime they described:
 *
 * - **the class that answers for it** — a table in `agents/session.ts`, so the neutral shell
 *   imported all four runtimes, which is the opposite of the layering `agents/backend.ts`
 *   claims;
 * - **its capabilities** — a constant in its own `backend.ts`, gathered into a second table
 *   in the shell;
 * - **the commands a dormant chat offers** — a third table, in the same file, listing what
 *   each backend's `commands()` answers when it is *not* running;
 * - **whether it can start on this machine** — a function in each runtime's own install or
 *   availability module, which nothing outside the runtime called until the first prompt
 *   failed. The browser could not ask, so the `+` menu offered a runtime that could not run.
 *
 * A module that exports one of these is a runtime. Adding a fifth is a directory and a row
 * in `registry.ts`; the shell never learns its name.
 */
export interface AgentRuntime {
	readonly kind: AgentKind;
	/** What a person calls it. `pi`, `claude`, `opencode`, `antigravity` — a runtime names itself in whatever case it uses, and its display name is a separate fact from its id. */
	readonly label: string;
	readonly capabilities: AgentCapabilities;
	/**
	 * What `/` completes to on a chat nobody has started, in the runtime's own words.
	 *
	 * The same list the backend answers with once it is running, because a menu that
	 * changes when a chat wakes up is a menu nobody can learn.
	 */
	readonly commands: SlashCommand[];
	/**
	 * Can this run here, and if not, why not — in a sentence written for the person who
	 * has to fix it.
	 *
	 * **A union rather than a flag and an optional sentence**, so "unavailable" cannot be
	 * reported without saying why. The menu greys a row out and shows the reason beside it;
	 * a disabled row with no explanation is the state this seam was built to end.
	 *
	 * Cheap enough to call on connect: every implementation is a `PATH` lookup or a file
	 * existence check, never a spawn.
	 */
	availability(): { available: true } | { available: false; reason: string };
	create(context: AgentBackendContext): Promise<AgentBackend>;
}
