import { readFileSync, writeFileSync } from "node:fs";
import { isBoardFormat, isBoardTemplate } from "../boards/templates.ts";
import type { WirePart } from "./context.ts";

/**
 * The board frames: the user's half of the canvas, and the two ways the past comes back.
 *
 * This is where the *user* touches a board — move, play, hide, create, delete, and the
 * drag-and-retype gestures that arrive as patches. The agent's writes do not come through
 * here at all: it edits the file with its own tools, and the watcher tells everyone.
 */
export const boards = {
	"board.move": (message, reply, wire) => {
		const board = wire.deck.setPosition(message.path, message.x, message.y);
		if (!board) {
			reply({ type: "error", text: `No such board: ${message.path}` });
			return;
		}
		// Broadcast rather than reply: a second tab is looking at the same
		// stage and the board has moved there too.
		wire.send({ type: "board.changed", path: board.path, rev: board.rev, board });
	},

	"board.extent": (message, _reply, wire) => {
		wire.noteExtent(message.path, { rev: message.rev, w: message.w, h: message.h });
		/*
		 * A flow board *is* its content's height.
		 *
		 * Markdown and plain documents have nowhere in the file to keep a height and
		 * no reason to: the browser has just measured the only true answer, so the
		 * board takes it. This is what makes "the board clips and nobody notices"
		 * impossible for these formats — there is no stored height to be wrong.
		 *
		 * Three guards, and each one is a loop that was easy to write by accident:
		 *
		 * - `setSize` returns nothing when the numbers already match, so a
		 *   measurement that agrees with the record neither saves nor bumps `rev`,
		 *   and the frame that produced it is not reloaded to be asked again;
		 * - only the height is taken. The width is the user's, from a drag, and a
		 *   measurement that also set it would fight the drag that caused it;
		 * - the reading must be for the revision the board is actually at, or a
		 *   measurement of a document that has since been rewritten sets the height
		 *   of one that no longer exists.
		 */
		const flowing = wire.deck.board(message.path);
		if (flowing?.format === "flow" && flowing.rev === message.rev) {
			const resized = wire.deck.setSize(message.path, { h: message.h });
			if (resized) wire.send({ type: "deck.state", deck: wire.deck.state() });
		}
	},

	"board.patch": (message, reply, wire) => {
		wire.patch(message.path, message.rev, message.patches, reply);
	},

	"board.undo": (message, reply, wire) => {
		wire.undo(message.path, reply);
	},

	/*
	 * The user's half of the canvas. Playing a board is how the rail works as a control;
	 * hiding takes it off the canvas and deliberately does *not* detach — the context is
	 * the agent's, and nobody should be able to strip what it is working from by tidying
	 * the view.
	 */
	"board.play": (message, _reply, wire) => {
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, message.path]);
	},

	"board.hide": (message, _reply, wire) => {
		const agent = wire.agents.focused();
		agent.setInPlay(agent.inPlay.filter((path) => path !== message.path));
	},

	/*
	 * A new board, and it goes straight onto the canvas.
	 *
	 * Created *and* played, because the two are one act: nobody asks for a board in
	 * order to leave it in the deck. Attached too — `setInPlay` puts it in the focused
	 * agent's context — so the agent you are talking to can see the thing you just
	 * made without being told about it.
	 *
	 * An unknown `kind` becomes `blank` rather than an error. This arrives from a
	 * button today, and the worst outcome of a bad template name should be an empty
	 * board rather than a refusal.
	 */
	"board.create": (message, reply, wire) => {
		const template = isBoardTemplate(message.kind) ? message.kind : "blank";
		// An unknown format is component, for the same reason an unknown template is
		// blank: the worst outcome of a typo should be an ordinary empty board.
		const format = isBoardFormat(message.format) ? message.format : "component";
		/*
		 * A title, a size and a place when the browser has something to put on the board: a
		 * file dropped on empty canvas, which gets a board of its own where it was dropped.
		 * Clamped rather than trusted, like everything a browser sends about a file.
		 */
		const bounded = (value: unknown, low: number, high: number) =>
			typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined;
		const title = typeof message.title === "string" && message.title.trim() !== "" ? message.title.trim().slice(0, 120) : "Untitled";
		const w = bounded(message.size?.w, 320, 2400);
		const h = bounded(message.size?.h, 240, 4000);
		const size = w !== undefined || h !== undefined ? { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) } : undefined;
		const path = wire.newBoard({ title, template, format, ...(size ? { size } : {}) });
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, path]);
		if (message.at && Number.isFinite(message.at.x) && Number.isFinite(message.at.y)) {
			const placed = wire.deck.setPosition(path, Math.round(message.at.x), Math.round(message.at.y));
			if (placed) wire.send({ type: "board.changed", path: placed.path, rev: placed.rev, board: placed });
		}
		// After the board is announced, so the asker already holds it when it hears the path.
		if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
	},

	"board.delete": (message, reply, wire) => {
		wire.deleteBoard(message.path, reply);
	},

	/*
	 * Declared since the first commit, and never wired up.
	 *
	 * **The typed table is what found it.** This variant has been in `ClientMessage` all
	 * along with no sender anywhere in the app and no case in the old switch, so it fell to
	 * `default:` and answered "Not implemented yet" — which is what it still answers, by name
	 * rather than by accident. The gauntlet this passed through is the one the table was built
	 * for: a frame either has an answer or it does not compile.
	 *
	 * Either somebody builds commenting on boards, or the variant goes. What is no longer true
	 * is that nobody knows.
	 */
	"board.comment": (_message, reply) => {
		reply({ type: "notice", level: "warn", text: "Not implemented yet: board.comment" });
	},

	/*
	 * A mirror, from the Agents tab.
	 *
	 * Created *and* played, the way `board.create` is, because nobody asks for a
	 * window onto a conversation in order to leave it closed. The name comes from
	 * the agent rather than from the person pressing the button, so two people
	 * mirroring the same agent land on the same board.
	 */
	"agent.mirror": (message, reply, wire) => {
		const of = wire.agents.summaries().find((candidate) => candidate.id === message.agentId);
		if (!of) {
			reply({ type: "notice", level: "warn", text: "That agent is not here any more." });
			return;
		}
		const path = wire.newMirror({ agentId: of.id, name: of.name });
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, path]);
	},

	"boards.restore": (message, reply, wire) => {
		/*
		 * The one place a preview turns into a write, and it takes a click of its
		 * own to get here. Restoring is a new revision rather than a rewind of the
		 * store: going back is a thing that happened, and undoing the restore has
		 * to be possible too.
		 */
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		const wanted = wire.boardsAt(agent, message.entryId);
		let restored = 0;
		for (const [path, sha] of Object.entries(wanted)) {
			try {
				const content = wire.revisions.read(sha);
				if (content === readFileSync(wire.deck.fileOf(path), "utf8")) continue;
				writeFileSync(wire.deck.fileOf(path), content);
				wire.revisions.record(path, content);
				restored++;
			} catch (error) {
				reply({ type: "notice", level: "warn", text: `Could not restore ${path}: ${(error as Error).message}` });
			}
		}
		reply({
			type: "notice",
			level: "info",
			text: restored === 0 ? "Those boards are already as they were." : `Restored ${restored} board${restored === 1 ? "" : "s"}.`,
		});
	},
} satisfies WirePart;
