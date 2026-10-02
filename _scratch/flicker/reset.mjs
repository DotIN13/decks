process.env.DECKS_E2E_WEB = "http://127.0.0.1:4431";
process.env.DECKS_E2E_API = "http://127.0.0.1:4431";
const { resetStage, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4431") throw new Error("wrong port");
await resetStage();
console.log("stage reset on", API);
