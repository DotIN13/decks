import type { WirePart } from "./context.ts";

/**
 * The install's Claude subscriptions, and which conversation spends which.
 *
 * Four frames that only ever move a *record* — a row in the account store, a symlink, a
 * field on an agent — and then republish the list so every picker in every tab agrees.
 * Kept apart from `agents.ts` because the subject is the install, not a conversation; the
 * one exception is `.add`, which has to run the login *through* an agent, because it is
 * the agent's dialog bridge that puts the code prompt on screen.
 */
export const accounts = {
	"claude.accounts": (_message, reply, wire) => {
		void wire.publishAccounts(reply);
	},

	"claude.accounts.add": (_message, reply, wire) => {
		/*
		 * The login runs on an *agent*, because it is the agent's dialog bridge that
		 * asks for the code — the flow needs somewhere to put a modal and somewhere to
		 * report to, and the conversation is both.
		 *
		 * A Claude agent, specifically: a pi agent has no Claude login to run. Focused
		 * first, since that is the conversation the person is looking at.
		 */
		const claude = [wire.agents.focused(), ...wire.agents.all()].find((agent) => agent.kind === "claude");
		if (!claude) {
			reply({ type: "notice", level: "warn", text: "Start a Claude agent first — signing in runs through one." });
			return;
		}
		void claude.prompt("/login");
	},

	"claude.accounts.use": (message, reply, wire) => {
		/*
		 * One conversation onto one subscription, and nothing else moves.
		 *
		 * There is no machine-wide switch to fall back to — this used to take an
		 * optional `agentId` and, without one, move the install default. Which was a
		 * control that looked like switching and was not: every open conversation kept
		 * the account it already had, so all it changed was the *next* agent. The list
		 * order answers that question now, visibly, with the arrows that were already
		 * there for it.
		 */
		const agent = wire.agents.all().find((candidate) => candidate.id === message.agentId);
		if (!agent) {
			reply({ type: "notice", level: "warn", text: "That agent is not here any more." });
			return;
		}
		if (!agent.useAccount(message.id)) {
			reply({ type: "notice", level: "warn", text: "That account is not on the list any more." });
			return;
		}
		/*
		 * And the runtime starts, if it has not yet.
		 *
		 * A chat nobody has prompted since the deck opened has no `claude` process, and
		 * a process's environment is fixed at spawn — so on a dormant chat this was a
		 * choice recorded in a file with nothing to show for it. Starting here makes the
		 * press mean what it looks like it means: the subscription is in force, and the
		 * model list and the context reading arrive with the session.
		 *
		 * Here rather than in `useAccount`, because *this* is the event — somebody
		 * pressed a row in a picker. The method stays a record and a symlink, which is
		 * what a rewind or a restore wants it to be.
		 */
		void agent.start();
		/*
		 * Warmed before the sessions want it: an account nothing has used for eight
		 * hours has an expired token, and the first request after a switch would
		 * otherwise be several sessions racing to refresh it (`claude/transient.ts`).
		 */
		void wire.warmAccount(message.id).then(() => wire.publishAccounts(undefined, { reread: true }));
	},

	"claude.accounts.forget": (message, _reply, wire) => {
		wire.claudeAccounts.forget(message.id);
		void wire.publishAccounts();
	},
} satisfies WirePart;
