import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { initI18n } from "./i18n/index.js";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root is missing");

await initI18n(navigator.languages);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
