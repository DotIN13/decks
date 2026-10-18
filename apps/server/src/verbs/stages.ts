import { isIsolatedStage } from "../stage/isolated-stages.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Stages (canvases): list them, move to one, name one, make one. */
export function stagesVerbs(ctx: VerbContext): Pick<Stage, "stages" | "open" | "title" | "newStage"> {
	const { service, agent, needPens, needStage, isolated, here } = ctx;
	return {
		/** Every stage in the deck, who has it open, and how much is on it. */
		stages: async () => {
			const pens = needPens();
			const mine = agent.stageName?.();
			const everyone = agent.agents();
			// Isolated, the isolated stages are all there are (`stage/isolated-stages.ts`).
			return pens.names().filter((name) => !isolated() || isIsolatedStage(pens, name)).map((name) => ({
				name,
				title: pens.titleOf(name),
				open: everyone.filter((other) => (other.id === agent.id ? mine : other.stage) === name).map((other) => other.name),
				boards: pens.boards(name).length,
				...(name === mine ? { mine: true } : {}),
			}));
		},
		/** Work on another stage: its boards are yours from now on, and the person sees it when talking to you. */
		open: async (name: string) => {
			if (typeof name !== "string" || !name.trim()) throw new Error('open names a stage, as in decks open deploy; decks stages lists them.');
			if (!agent.openStage) throw new Error("This agent cannot change stages.");
			// By its folder, or by what it is called: the person reads names, and an agent is told them.
			const pens = service.pens;
			const asked = name.trim();
			const folder = pens && !pens.names().includes(asked) ? (pens.names().find((one) => pens.titleOf(one).toLowerCase() === asked.toLowerCase()) ?? asked) : asked;
			agent.openStage(folder);
			// Who is on which stage is in every browser's stage list.
			service.stagesChanged();
			return { stage: folder, boards: agent.inPlay() };
		},
		/**
		 * Name the canvas you are on, or read its name. The name is what the person reads; the folder
		 * (`name` in `stages()`) stays as it is. Saying the same name again keeps it and marks what the
		 * canvas holds now as what the name is for (`stage/canvas-name.ts`).
		 */
		title: async (title?: string) => {
			const pens = needPens();
			const name = needStage();
			if (title !== undefined) {
				if (typeof title !== "string" || !title.trim()) throw new Error('title takes the canvas\'s new name, as in decks title "Launch plan"; decks title reads it.');
				const folder = service.retitle(name, title);
				service.stagesChanged?.();
				return { stage: folder, title: pens.titleOf(folder) };
			}
			return { stage: name, title: pens.titleOf(name) };
		},
		/** A new, empty stage named from a title, opened at once. */
		newStage: async (title: string) => {
			if (typeof title !== "string" || !title.trim()) throw new Error('newStage takes a title, as in decks new-stage "Launch plan".');
			if (!agent.newStage) throw new Error("This agent cannot make stages.");
			const made = agent.newStage(title.trim());
			service.stagesChanged();
			return { stage: made };
		},
	};
}
