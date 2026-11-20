// apps/utools/src/main.tsx
// uTools 插件入口文件

// Shared editor and lint code uses built-ins newer than uTools 7.x's Chromium 108.
import "core-js/actual/array/find-last";
import "core-js/actual/array/to-reversed";
import "core-js/actual/array/to-sorted";
import "core-js/actual/string/to-well-formed";

import React from "react";
import { createRoot } from "react-dom/client";
import { UtoolsApp } from "./components/UtoolsApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

function bootstrap(): void {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Missing #root element in index.html");
  }

  createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <UtoolsApp />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap();
