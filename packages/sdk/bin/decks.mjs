#!/usr/bin/env node
/**
 * `decks`: every Decks verb as a command, for an agent's shell and anyone else's.
 *
 *     decks boards | jq -r '.[].path'
 *     p=$(decks new-board --title "Q3 revenue" --at.x1 0 --at.y1 0)
 *     decks show "$p"
 *     decks fit "$p"
 *     decks pen edit '[{"op":"delete","id":"n1"}]'
 *     echo '[...]' | decks pen edit -
 *
 * A verb's plain arguments (a path, a name) are words; an object argument's keys are flags, with a
 * dot for a key inside a key (`--at.x1 0`); anything else is JSON, and `-` reads it from stdin.
 * `--args '<JSON list>'` gives every argument as JSON at once.
 *
 * The value goes to stdout: a string as it is, anything else as JSON. The notes a verb adds (what
 * `fit` measured, where a board went) go to stderr, and a refusal goes to stderr with exit code 1.
 * Who is calling is `DECKS_AGENT`, and where Decks is is `DECKS_URL`; Decks sets both in every
 * agent's shell.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connect, DecksError } from "../src/index.js";

const VERBS = JSON.parse(readFileSync(new URL("../src/verbs.json", import.meta.url), "utf8"));

const out = (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
const err = (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);

/** The verb a command line names, and the words after it: `pen edit x` -> pen.edit, [x]. */
export function verbOf(words) {
	for (const take of [2, 1]) {
		const command = words.slice(0, take);
		const verb = VERBS.find((one) => one.command.join(" ") === command.join(" "));
		if (verb) return { verb, rest: words.slice(take) };
	}
	return undefined;
}

export function help(verb) {
	if (verb) {
		const lines = [`decks ${verb.command.join(" ")}`, "", `  ${verb.signature}: ${verb.returns}`, "", wrap(verb.summary, "  "), ""];
		for (const param of verb.params) lines.push(`  ${param.name}${param.optional ? " (optional)" : ""}: ${param.type}`);
		const objects = verb.params.filter((param) => param.schema.type === "object" && param.schema.properties);
		if (objects.length) lines.push("", `  Flags: ${objects.flatMap((param) => Object.keys(param.schema.properties).map((key) => `--${key}`)).join(" ")}`);
		return lines.join("\n");
	}
	const groups = new Map();
	for (const one of VERBS) groups.set(one.group, [...(groups.get(one.group) ?? []), one]);
	const lines = ["decks <command> [arguments] [--flags]: every Decks verb, as a command.", "", "Each prints its value to stdout (JSON, or a string as it is) and its notes to stderr.", ""];
	for (const [group, verbs] of groups) {
		lines.push(`${group}:`);
		for (const one of verbs) lines.push(`  ${one.command.join(" ").padEnd(16)} ${firstSentence(one.summary)}`);
		lines.push("");
	}
	lines.push("decks help <command> says more about one. DECKS_URL and DECKS_AGENT say where Decks is and who is calling.");
	return lines.join("\n");
}

const firstSentence = (text) => {
	const end = text.search(/[.:](\s|$)/);
	return end > 0 ? text.slice(0, end + 1) : text;
};

function wrap(text, indent) {
	const lines = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		if (line && line.length + word.length > 92) {
			lines.push(indent + line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(indent + line);
	return lines.join("\n");
}

let stdin;
const readStdin = () => (stdin ??= readFileSync(0, "utf8"));

/** A word as the shape wants it: JSON for anything but a string, `-` for stdin. */
function valueOf(word, schema) {
	if (word === "-") word = readStdin().trim();
	const wantsString = schema && (schema.type === "string" || (schema.enum && schema.enum.every((one) => typeof one === "string")));
	if (wantsString) return word;
	if (schema && (schema.type === "number" || schema.type === "integer")) {
		const number = Number(word);
		return Number.isFinite(number) ? number : word;
	}
	if (schema && schema.type === "boolean") return word === "true" ? true : word === "false" ? false : word;
	try {
		return JSON.parse(word);
	} catch {
		return word;
	}
}

/** The schema of a dotted key inside an object schema, or nothing. */
function schemaAt(schema, keys) {
	let here = schema;
	for (const key of keys) {
		const options = here?.anyOf ?? [here];
		here = options.map((one) => one?.properties?.[key]).find(Boolean);
		if (!here) return undefined;
	}
	return here;
}

/** The arguments a command line gives a verb, as the list the verb takes. */
export function argsOf(verb, words) {
	const args = new Array(verb.params.length).fill(undefined);
	const positional = [];
	const flags = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		if (word.startsWith("--") && word.length > 2) {
			const eq = word.indexOf("=");
			const key = eq > 0 ? word.slice(2, eq) : word.slice(2);
			let value = eq > 0 ? word.slice(eq + 1) : words[index + 1];
			if (eq < 0) {
				if (value === undefined || (value.startsWith("--") && value.length > 2)) value = "true";
				else index++;
			}
			flags.push([key, value]);
		} else positional.push(word);
	}

	const asJson = flags.find(([key]) => key === "args");
	if (asJson) return JSON.parse(asJson[1] === "-" ? readStdin() : asJson[1]);

	// Flags fill the first object parameter that has the key.
	const objects = verb.params.map((param, index) => [param, index]).filter(([param]) => param.schema.type === "object" || param.schema.anyOf?.some((one) => one.type === "object"));
	for (const [key, raw] of flags) {
		const keys = key.split(".");
		const home = objects.find(([param]) => schemaAt(param.schema, keys.slice(0, 1)));
		if (!home) throw new DecksError(`decks ${verb.command.join(" ")} has no flag --${key}.\n\n${help(verb)}`);
		const [param, index] = home;
		args[index] ??= {};
		let target = args[index];
		for (const part of keys.slice(0, -1)) target = target[part] ??= {};
		target[keys[keys.length - 1]] = valueOf(raw, schemaAt(param.schema, keys));
	}

	// Words fill the parameters flags did not, in order; a list of paths takes every word left.
	let next = 0;
	for (const [index, param] of verb.params.entries()) {
		if (next >= positional.length) break;
		if (args[index] !== undefined) continue;
		if (param.variadic) {
			const rest = positional.slice(next);
			args[index] = rest.length === 1 ? rest[0] : rest;
			next = positional.length;
			break;
		}
		args[index] = valueOf(positional[next++], param.schema);
	}
	if (next < positional.length) throw new DecksError(`decks ${verb.command.join(" ")} takes ${verb.params.length} argument${verb.params.length === 1 ? "" : "s"}; "${positional.slice(next).join(" ")}" is left over.\n\n${help(verb)}`);
	while (args.length && args[args.length - 1] === undefined) args.pop();
	return args;
}

async function main(argv) {
	const words = argv.filter((word) => word !== "--help" && word !== "-h");
	const asksHelp = words.length !== argv.length;
	if (words.length === 0 || (words[0] === "help" && words.length === 1)) {
		out(help());
		return 0;
	}
	if (words[0] === "help") {
		const found = verbOf(words.slice(1));
		out(found ? help(found.verb) : help());
		return found ? 0 : 1;
	}
	const found = verbOf(words);
	if (!found) {
		err(`decks: no command "${words.slice(0, 2).join(" ")}". decks --help lists them.`);
		return 1;
	}
	if (asksHelp) {
		out(help(found.verb));
		return 0;
	}
	const args = argsOf(found.verb, found.rest);
	const decks = connect({ notes: () => {} });
	const { value, notes } = await decks.call(found.verb.name, args);
	if (value !== undefined && value !== null) out(typeof value === "string" ? value : JSON.stringify(value, null, 2));
	for (const note of notes) err(note);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		if (error instanceof DecksError) {
			err(`decks: ${error.message}`);
			for (const note of error.notes ?? []) err(note);
		} else err(`decks: ${error?.stack ?? error}`);
		process.exit(1);
	},
);
