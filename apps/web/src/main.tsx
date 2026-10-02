import "./fonts.js";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { initI18n } from "./i18n/index.js";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root is missing");

const i18n = await initI18n(navigator.languages);

createRoot(root).render(
  <StrictMode>
    <App i18n={i18n} />
  </StrictMode>,
);
