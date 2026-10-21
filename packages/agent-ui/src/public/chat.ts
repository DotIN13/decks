/** The agent conversation, as the canvas draws it: the stream of turns, and how a tool's full result is asked for. */
export { Stream } from "../chat/Stream.tsx";
export { askFullResult, awaitingResult, forgetAskedResults, fullResult, receiveToolResult, resetToolResults, setToolResultSender } from "../chat/tool-results.ts";
