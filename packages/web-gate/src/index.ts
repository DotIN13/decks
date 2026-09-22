/**
 * `@decks/web-gate` — a browser agent's speed, inside a browser somebody is logged into.
 *
 * The shape of the problem this package solves: a goal-driven browser agent is useful
 * because it decides and acts on its own, and it is unusable in a browser holding
 * somebody's logins for exactly the same reason. The two halves are not a trade to be
 * balanced, they are two commands to be held — the press that sends something, and the
 * text that goes into a field.
 *
 * So this is a DevTools Protocol proxy and nothing else. It listens on loopback, forwards
 * every command to a real Chrome, and stops the two kinds that matter until whoever is
 * supervising says yes. The agent attaches to it exactly as it would attach to a browser,
 * which is what makes the gate impossible to argue with and invisible to the agent.
 *
 * What it deliberately does not own:
 *
 * - **Who is asked.** `hooks.allow` and `hooks.words` are functions. A person pressing
 *   Allow on a board, another agent on its next turn, and a test are all the same to it.
 * - **The browser.** It does not launch one, find one, or know whose it is. It is given an
 *   endpoint and it forwards to it.
 * - **What the agent is for.** No goal, no step budget, no transcript beyond the events it
 *   reports. `onEvent` is a callback, not a log.
 * - **A model.** Nothing here calls one. The words that go into a field come from the
 *   caller; this package never has an opinion about what should be typed.
 */

export { WebGate, type GateEvent, type GateHooks, type GateOptions, type GateQuestion } from "./proxy.ts";
export { classify, clickProbe, clickTarget, fieldProbe, judgeClick, type CdpMessage, type ClickTarget, type Decision } from "./gate.ts";
