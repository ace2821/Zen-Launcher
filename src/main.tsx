import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import "./styles/global.css";

// i18n is synchronous (`initAsync: false`), so the first paint is already in
// the right language and nothing flickers between locales.
initI18n();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Zen Launcher: #root is missing from index.html");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
