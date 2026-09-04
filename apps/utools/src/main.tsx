// apps/utools/src/main.tsx
// uTools 插件入口文件

import React from "react";
import { createRoot } from "react-dom/client";
import { UtoolsApp } from "./components/UtoolsApp";
import "./styles.css";

function bootstrap(): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing #root element in index.html");
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <UtoolsApp />
    </React.StrictMode>,
  );
}

void bootstrap();
