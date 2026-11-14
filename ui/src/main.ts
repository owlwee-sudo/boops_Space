import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/figma.css";
import { createApp } from "./app/App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");
createApp(root);
