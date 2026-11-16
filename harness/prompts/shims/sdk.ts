// The SDK as an agent's own node scripts take it, connected as that agent:
// const { decks } = await import(process.env.DECKS_SDK)
import { connect } from "../../../clients/sdk/index.ts"

export const decks = (await connect()).decks
export { connect }
