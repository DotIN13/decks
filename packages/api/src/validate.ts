import { tsOf, type Schema } from "./schema.ts";
import type { Verb } from "./verbs.ts";

/**
 * Check a verb's arguments against its table entry, before any handler sees them.
 *
 * Answers with a sentence, or nothing when the arguments fit. The sentence names the argument,
 * says what was expected in TypeScript's words, and ends with the verb's signature, because the
 * caller is usually a model, and the next line it writes should be the right call.
 *
 * Unknown keys in an object are refused: `{ titel: "…" }` is a typo, and a typo that is quietly
 * ignored makes a card with no title and no explanation.
 */
export function checkArgs(verb: Verb, args: readonly unknown[]): string | undefined {
	const params = verb.params;
	// Trailing nulls and undefineds stand for "left out", as a JSON array can only say null.
	const given = [...args];
	while (given.length && (given[given.length - 1] === undefined || given[given.length - 1] === null)) {
		const index = given.length - 1;
		if (!params[index]?.optional && params[index]) break;
		given.pop();
	}
	if (given.length > params.length) return `${verb.name} takes ${params.length} argument${params.length === 1 ? "" : "s"}, not ${given.length}. ${signature(verb)}`;
	for (const [index, param] of params.entries()) {
		const value = given[index];
		if (value === undefined) {
			if (param.optional) continue;
			return `${verb.name} needs ${param.name}. ${signature(verb)}`;
		}
		const problem = check(param.schema, value, param.name);
		if (problem) return `${verb.name}: ${problem}. ${signature(verb)}`;
	}
	return undefined;
}

/** The verb as a TypeScript signature: `move(path: string, at: Point)`. */
export function signature(verb: Verb): string {
	return `${verb.name}(${verb.params.map((param) => `${param.name}${param.optional ? "?" : ""}: ${tsOf(param.schema)}`).join(", ")})`;
}

/** What is wrong with `value` as a `schema`, said about `where`, or nothing. */
export function check(schema: Schema, value: unknown, where: string): string | undefined {
	if ("any" in schema) return undefined;
	if ("anyOf" in schema) {
		const answers = schema.anyOf.map((option) => check(option, value, where));
		if (answers.some((answer) => answer === undefined)) return undefined;
		// One option that matches the value's kind says the most; otherwise list the shapes.
		const sameKind = schema.anyOf.filter((option) => kindOf(option) === describe(value));
		if (sameKind.length === 1) return check(sameKind[0]!, value, where);
		return `${where} is ${describe(value)}, where ${tsOf(schema)} is expected`;
	}
	if ("enum" in schema) {
		return schema.enum.includes(value as string) ? undefined : `${where} is ${JSON.stringify(value)}, where one of ${schema.enum.map((one) => JSON.stringify(one)).join(", ")} is expected`;
	}
	switch (schema.type) {
		case "string":
			return typeof value === "string" ? undefined : `${where} is ${describe(value)}, where a string is expected`;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) return `${where} is ${describe(value)}, where a number is expected`;
			return schema.integer && !Number.isInteger(value) ? `${where} is ${value}, where a whole number is expected` : undefined;
		case "boolean":
			return typeof value === "boolean" ? undefined : `${where} is ${describe(value)}, where true or false is expected`;
		case "null":
			return value === null ? undefined : `${where} is ${describe(value)}, where null is expected`;
		case "array": {
			if (!Array.isArray(value)) return `${where} is ${describe(value)}, where a list is expected`;
			for (const [index, item] of value.entries()) {
				const problem = check(schema.items, item, `${where}[${index}]`);
				if (problem) return problem;
			}
			return undefined;
		}
		case "object": {
			if (!value || typeof value !== "object" || Array.isArray(value)) return `${where} is ${describe(value)}, where ${tsOf(schema)} is expected`;
			const record = value as Record<string, unknown>;
			for (const name of schema.required) {
				if (record[name] === undefined) return `${where}.${name} is missing`;
			}
			for (const [name, item] of Object.entries(record)) {
				if (item === undefined) continue;
				const shape = schema.properties[name];
				if (shape) {
					// An optional property sent as null means "left out", as JSON has no undefined.
					if (item === null && !schema.required.includes(name) && !accepts(shape, null)) continue;
					const problem = check(shape, item, `${where}.${name}`);
					if (problem) return problem;
				} else if (schema.additional === undefined) {
					const known = Object.keys(schema.properties);
					return `${where} has no key "${name}"${known.length ? `; it takes ${known.join(", ")}` : ""}`;
				} else if (schema.additional !== true) {
					const problem = check(schema.additional, item, `${where}.${name}`);
					if (problem) return problem;
				}
			}
			return undefined;
		}
	}
	return undefined;
}

function accepts(schema: Schema, value: unknown): boolean {
	return check(schema, value, "") === undefined;
}

function kindOf(schema: Schema): string | undefined {
	if ("type" in schema) return schema.type === "array" ? "a list" : schema.type === "object" ? "an object" : schema.type === "string" ? "a string" : schema.type === "number" ? "a number" : schema.type === "boolean" ? "true or false" : "null";
	return undefined;
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "a list";
	switch (typeof value) {
		case "string":
			return "a string";
		case "number":
			return "a number";
		case "boolean":
			return "true or false";
		case "object":
			return "an object";
		default:
			return typeof value;
	}
}
