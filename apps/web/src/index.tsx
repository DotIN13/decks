/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root to render into");
render(() => <App />, root);
