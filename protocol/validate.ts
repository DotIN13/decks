import type { Node } from "./schema.ts";

// Check a value against a shape. Answers the problems found, each a sentence
// naming where the value went wrong; an empty list means it fits.

const KINDS: Record<string, string> = { str: "a string", num: "a number", bool: "true or false", null: "null" };

export function check(node: Node, value: unknown, at = "the value"): string[] {
	switch (node.k) {
		case "any":
			return [];
		case "str":
			return typeof value === "string" ? [] : [`${at} should be ${KINDS.str}.`];
		case "num":
			return checkNumber(node.int === true, value, at);
		case "bool":
			return typeof value === "boolean" ? [] : [`${at} should be ${KINDS.bool}.`];
		case "null":
			return value === null ? [] : [`${at} should be null.`];
		case "lit":
			return node.values.includes(value as never) ? [] : [`${at} should be one of ${node.values.map((v) => JSON.stringify(v)).join(", ")}.`];
		case "arr":
			if (!Array.isArray(value)) return [`${at} should be a list.`];
			return value.flatMap((one, i) => check(node.items, one, `${at}[${i}]`));
		case "union":
			return node.of.some((one) => check(one, value, at).length === 0) ? [] : [`${at} fits none of the shapes it may take.`];
		case "obj":
			return checkObject(node, value, at);
	}
}

function checkNumber(int: boolean, value: unknown, at: string): string[] {
	if (typeof value !== "number" || !Number.isFinite(value)) return [`${at} should be ${KINDS.num}.`];
	return int && !Number.isInteger(value) ? [`${at} should be a whole number.`] : [];
}

function checkObject(node: Extract<Node, { k: "obj" }>, value: unknown, at: string): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${at} should be an object.`];
	const record = value as Record<string, unknown>;
	const problems: string[] = [];
	for (const key of node.required) if (record[key] === undefined) problems.push(`${at} needs ${key}.`);
	for (const [key, one] of Object.entries(record)) {
		if (one === undefined) continue;
		const inner = node.props[key];
		if (inner) problems.push(...check(inner, one, `${at}.${key}`));
		else if (node.rest === undefined) problems.push(`${at} has ${key}, which it does not take.`);
		else if (node.rest !== true) problems.push(...check(node.rest, one, `${at}.${key}`));
	}
	return problems;
}
