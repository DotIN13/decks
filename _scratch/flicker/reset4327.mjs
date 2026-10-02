process.env.DECKS_E2E_WEB = "http://127.0.0.1:4327";
process.env.DECKS_E2E_API = "http://127.0.0.1:4327";
const { resetStage, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4327") throw new Error("wrong port");
await resetStage();
console.log("boards played on", API);
