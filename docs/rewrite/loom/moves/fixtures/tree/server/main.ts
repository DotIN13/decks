import { draw } from "@x/eng";
import { extra } from "../packages/lib/src/extra.ts";
const deep = new URL("../packages/lib/src/deep/", import.meta.url);
const bin = "../packages/eng/target/bin";
export const all = [draw, extra, deep, bin, "@x/engine-not-this"];
