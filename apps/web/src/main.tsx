import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element in index.html");

// Keep the regular application and its storage/AI initialization out of the preview route.
const component = location.pathname.replace(/\/$/, "").endsWith("/plugins")
  ? import("./plugin-preview/PluginPreviewPage").then((module) => module.PluginPreviewPage)
  : import("./App").then((module) => module.App);
void component.then((Component) =>
  createRoot(rootElement).render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>,
  ),
);
