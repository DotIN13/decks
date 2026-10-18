/**
 * The shapes a verb takes and gives, written once and read three ways.
 *
 * A shape here is plain JSON Schema (the subset MCP and every validator understand), built with
 * the small functions below so the table in `verbs.ts` reads like a type signature. The same
 * object is then:
 *
 * - **checked** on the server, by `validate.ts`, before a handler sees the arguments;
 * - **printed as TypeScript**, by `tsOf`, into the SDK's declarations;
 * - **handed to MCP clients** as each tool's input schema, by `jsonSchemaOf`.
 *
 * No library: the SDK this feeds is a file with no dependencies, and the subset is small enough
 * that a validator and a printer are a page each. A shape that has a name (`named`) prints as
 * that name in TypeScript and is declared once; in JSON Schema it is written out in place.
 */

export type Schema =
	| { type: "string"; description?: string; $name?: string }
	| { type: "number"; description?: string; integer?: boolean; $name?: string }
	| { type: "boolean"; description?: string; $name?: string }
	| { type: "null"; description?: string; $name?: string }
	| { enum: readonly (string | number | boolean)[]; description?: string; $name?: string }
	| { type: "array"; items: Schema; description?: string; $name?: string }
	| {
			type: "object";
			properties: Record<string, Schema>;
			required: string[];
			/** Other keys: `true` for any value, a shape for one shape, absent for none. */
			additional?: Schema | true;
			description?: string;
			$name?: string;
	  }
	| { anyOf: Schema[]; description?: string; $name?: string }
	| { any: true; description?: string; $name?: string };

/** An optional property of an object: `obj({ at: opt(point) })`. */
export interface Optional {
	optional: Schema;
}

export const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
export const num = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
export const int = (description?: string): Schema => ({ type: "number", integer: true, ...(description ? { description } : {}) });
export const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
export const nul: Schema = { type: "null" };
export const any = (description?: string): Schema => ({ any: true, ...(description ? { description } : {}) });
export const lit = (...values: (string | number | boolean)[]): Schema => ({ enum: values });
export const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
export const union = (...options: Schema[]): Schema => ({ anyOf: options });
export const opt = (schema: Schema): Optional => ({ optional: schema });

/** An object; a property wrapped in `opt` may be left out. `rest` allows other keys. */
export function obj(properties: Record<string, Schema | Optional>, rest?: Schema | true): Schema {
	const shapes: Record<string, Schema> = {};
	const required: string[] = [];
	for (const [key, value] of Object.entries(properties)) {
		if ("optional" in value) shapes[key] = value.optional;
		else {
			shapes[key] = value;
			required.push(key);
		}
	}
	return { type: "object", properties: shapes, required, ...(rest ? { additional: rest } : {}) };
}

/** A map of string keys to one shape: `Record<string, T>`. */
export const rec = (value: Schema | true): Schema => ({ type: "object", properties: {}, required: [], additional: value });

/** Give a shape a name, so TypeScript prints `Board` rather than the whole object each time. */
export function named<S extends Schema>(name: string, schema: S, description?: string): S {
	return { ...schema, $name: name, ...(description ? { description } : {}) };
}

/** A property name TypeScript accepts bare, or one it needs quoted. */
const IDENT = /^[A-Za-z_$][\w$]*$/;
const key = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));

/**
 * The TypeScript for a shape. Named shapes print as their name unless `expand` is set, which is
 * how their own declaration is written.
 */
export function tsOf(schema: Schema, expand = false): string {
	if (schema.$name && !expand) return schema.$name;
	if ("any" in schema) return "unknown";
	if ("anyOf" in schema) return schema.anyOf.map((one) => wrap(tsOf(one))).join(" | ");
	if ("enum" in schema) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
	switch (schema.type) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		case "array":
			return `${wrap(tsOf(schema.items))}[]`;
		case "object": {
			const fields = Object.entries(schema.properties).map(([name, shape]) => `${key(name)}${schema.required.includes(name) ? "" : "?"}: ${tsOf(shape)}`);
			if (schema.additional) fields.push(`[key: string]: ${schema.additional === true ? "unknown" : tsOf(schema.additional)}`);
			if (fields.length === 0) return "Record<string, never>";
			if (fields.length === 1 && Object.keys(schema.properties).length === 0 && schema.additional) {
				return `Record<string, ${schema.additional === true ? "unknown" : tsOf(schema.additional)}>`;
			}
			return `{ ${fields.join("; ")} }`;
		}
	}
	return "unknown";
}

/** A union inside an array or another union needs brackets. */
function wrap(text: string): string {
	return text.includes(" | ") && !text.startsWith("{") ? `(${text})` : text;
}

/** Plain JSON Schema, every named shape written out where it is used: what MCP clients read. */
export function jsonSchemaOf(schema: Schema): Record<string, unknown> {
	const description = schema.description ? { description: schema.description } : {};
	if ("any" in schema) return { ...description };
	if ("anyOf" in schema) return { anyOf: schema.anyOf.map(jsonSchemaOf), ...description };
	if ("enum" in schema) return { enum: [...schema.enum], ...description };
	switch (schema.type) {
		case "array":
			return { type: "array", items: jsonSchemaOf(schema.items), ...description };
		case "object":
			return {
				type: "object",
				properties: Object.fromEntries(Object.entries(schema.properties).map(([name, shape]) => [name, jsonSchemaOf(shape)])),
				...(schema.required.length ? { required: schema.required } : {}),
				additionalProperties: schema.additional === undefined ? false : schema.additional === true ? true : jsonSchemaOf(schema.additional),
				...description,
			};
		case "number":
			return { type: schema.integer ? "integer" : "number", ...description };
		default:
			return { type: schema.type, ...description };
	}
}

/** Every named shape a shape uses, itself included, in the order they are first met. */
export function namesIn(schema: Schema, into = new Map<string, Schema>()): Map<string, Schema> {
	if (schema.$name) {
		if (into.has(schema.$name)) return into;
		into.set(schema.$name, schema);
	}
	if ("anyOf" in schema) for (const one of schema.anyOf) namesIn(one, into);
	else if ("type" in schema && schema.type === "array") namesIn(schema.items, into);
	else if ("type" in schema && schema.type === "object") {
		for (const shape of Object.values(schema.properties)) namesIn(shape, into);
		if (schema.additional && schema.additional !== true) namesIn(schema.additional, into);
	}
	return into;
}
