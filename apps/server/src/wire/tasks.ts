import type { WirePart } from "./context.ts";

/**
 * The dashboard's frames: tasks and schedules, both directions.
 *
 * Everything the panel or `stage.task` asks lands here and is answered with the
 * whole `tasks` broadcast — the service publishes on every change, so the reply is
 * one line and the panel's store is always the server's. The errors that matter are
 * the honest ones — a task that cannot be cancelled because it is running, a time
 * that is not a time — and they come back as notices rather than as failed creates:
 * the panel keeps its text, which a thrown frame would not.
 */
export const tasks = {
	"task.create": (message, reply, wire) => {
		try {
			wire.tasks.create({ ...message.task }, undefined, message.requestedBy);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	},

	"task.cancel": (message, reply, wire) => {
		const outcome = wire.tasks.cancel(message.id);
		// A cancel that cannot happen has a reason worth saying; one that happened
		// announces itself through the broadcast.
		if (!outcome.cancelled && outcome.reason) reply({ type: "notice", level: "warn", text: outcome.reason });
	},

	"task.retry": (message, reply, wire) => {
		const outcome = wire.tasks.retry(message.id);
		if ("error" in outcome) reply({ type: "notice", level: "warn", text: outcome.error });
	},

	"schedule.create": (message, reply, wire) => {
		const outcome = wire.tasks.createSchedule(message.schedule);
		if ("error" in outcome) reply({ type: "notice", level: "warn", text: outcome.error });
	},

	"schedule.cancel": (message, _reply, wire) => {
		wire.tasks.cancelSchedule(message.id);
	},

	"schedule.run": (message, reply, wire) => {
		const outcome = wire.tasks.runNow(message.id);
		if ("error" in outcome) reply({ type: "notice", level: "warn", text: outcome.error });
	},
} satisfies WirePart;