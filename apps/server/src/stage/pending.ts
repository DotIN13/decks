export interface PendingStage {
	resolve: (value: unknown) => void;
	timer: NodeJS.Timeout;
	many?: { answers: unknown[]; expected: number };
}

/** A front end's answer to an agent's view call (`view.called`): settles the call waiting on it, or several when many screens were asked. */
export function settleStage(pendingStage: Map<string, PendingStage>, result: { id: string; value?: unknown; error?: string }): boolean {
	const pending = pendingStage.get(result.id);
	if (!pending) return false;
	const value = result.error ? { error: result.error } : (result.value ?? null);
	if (pending.many) {
		pending.many.answers.push(value);
		if (pending.many.answers.length < pending.many.expected) return true;
		pendingStage.delete(result.id);
		clearTimeout(pending.timer);
		pending.resolve(pending.many.answers);
		return true;
	}
	pendingStage.delete(result.id);
	clearTimeout(pending.timer);
	pending.resolve(value);
	return true;
}
