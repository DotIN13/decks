// The small schema builders. A shape is plain data the generators can walk,
// and it carries its TypeScript type, read with Infer<typeof shape>.

declare const TYPE: unique symbol;

// Shapes, and the type each carries.
export type Scalar = string | number | boolean;

export type Node =
	| { k: "str"; name?: string; doc?: string }
	| { k: "num"; int?: boolean; name?: string; doc?: string }
	| { k: "bool"; name?: string; doc?: string }
	| { k: "null"; name?: string; doc?: string }
	| { k: "any"; name?: string; doc?: string }
	| { k: "lit"; values: readonly Scalar[]; name?: string; doc?: string }
	| { k: "arr"; items: Node; name?: string; doc?: string }
	| { k: "obj"; props: Record<string, Node>; required: readonly string[]; rest?: Node | true; name?: string; doc?: string }
	| { k: "union"; of: readonly Node[]; name?: string; doc?: string };

/** A node that also carries the TypeScript type it describes. */
export type Shape<T = unknown> = Node & { readonly [TYPE]: T };
/** The TypeScript type of a shape. */
export type Infer<S> = S extends { readonly [TYPE]: infer T } ? T : never;

/** An object property that may be left out: obj({ at: opt(Point) }). */
export interface Opt<S extends Shape<any> = Shape<any>> {
	readonly opt: S;
}
export type Props = Record<string, Shape<any> | Opt>;

type Flat<T> = { [K in keyof T]: T[K] } & {};
type Needed<P extends Props> = { [K in keyof P as P[K] extends Opt ? never : K]: Infer<P[K]> };
type Optional<P extends Props> = { [K in keyof P as P[K] extends Opt ? K : never]?: P[K] extends Opt<infer S> ? Infer<S> : never };
/** The type of an object built from props. */
export type ObjOf<P extends Props> = Flat<Needed<P> & Optional<P>>;

// The builders.
const shape = <T>(node: Node): Shape<T> => node as Shape<T>;
const withDoc = (doc?: string) => (doc ? { doc } : {});

export const str = (doc?: string) => shape<string>({ k: "str", ...withDoc(doc) });
export const num = (doc?: string) => shape<number>({ k: "num", ...withDoc(doc) });
export const int = (doc?: string) => shape<number>({ k: "num", int: true, ...withDoc(doc) });
export const bool = (doc?: string) => shape<boolean>({ k: "bool", ...withDoc(doc) });
export const nul = shape<null>({ k: "null" });
export const any = (doc?: string) => shape<unknown>({ k: "any", ...withDoc(doc) });

export function lit<const V extends readonly Scalar[]>(...values: V): Shape<V[number]> {
	return shape({ k: "lit", values });
}

export function arr<S extends Shape<any>>(items: S, doc?: string): Shape<Infer<S>[]> {
	return shape({ k: "arr", items, ...withDoc(doc) });
}

export function union<S extends Shape<any>[]>(...of: S): Shape<Infer<S[number]>> {
	return shape({ k: "union", of });
}

export const opt = <S extends Shape<any>>(s: S): Opt<S> => ({ opt: s });

/** An object; a property wrapped in opt may be left out. */
export function obj<P extends Props>(props: P): Shape<ObjOf<P>>;
/** An object that also takes any other key. */
export function obj<P extends Props>(props: P, rest: true): Shape<ObjOf<P> & { [key: string]: unknown }>;
export function obj<P extends Props>(props: P, rest?: true): Shape<unknown> {
	const out: Record<string, Node> = {};
	const required: string[] = [];
	for (const [key, value] of Object.entries(props)) {
		if ("opt" in value) out[key] = value.opt;
		else {
			out[key] = value;
			required.push(key);
		}
	}
	return shape({ k: "obj", props: out, required, ...(rest ? { rest } : {}) });
}

/** A map from string keys to one shape. */
export function rec<S extends Shape<any>>(value: S): Shape<Record<string, Infer<S>>> {
	return shape({ k: "obj", props: {}, required: [], rest: value });
}

// Naming shapes, and finding the named ones.
/** Give a shape a name, so generated code declares it once and refers to it. */
export function named<S extends Shape<any>>(name: string, s: S, doc?: string): S {
	return { ...s, name, ...withDoc(doc ?? s.doc) } as S;
}

/** Every named shape inside a node, itself included, in the order first met. */
export function namesIn(node: Node, into = new Map<string, Node>()): Map<string, Node> {
	if (node.name) {
		if (into.has(node.name)) return into;
		into.set(node.name, node);
	}
	if (node.k === "union") for (const one of node.of) namesIn(one, into);
	if (node.k === "arr") namesIn(node.items, into);
	if (node.k === "obj") {
		for (const one of Object.values(node.props)) namesIn(one, into);
		if (node.rest && node.rest !== true) namesIn(node.rest, into);
	}
	return into;
}
