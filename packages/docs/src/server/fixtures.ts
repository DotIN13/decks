import { relative, resolve } from "node:path";

/** For tests: the simplest resolver a host could write, paths inside one folder, keyed relative to it. */
export function inside(root: string) {
	return (path: string) => {
		const file = resolve(root, path);
		const key = relative(root, file);
		if (key.startsWith("..")) throw new Error(`${path} is outside the folder`);
		return { file, key, writable: true };
	};
}
