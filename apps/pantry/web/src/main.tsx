import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "@stack/auth-ui";
import { StackAuthProvider } from "./authProvider";
import { App } from "./App";
import { HouseholdProvider } from "./household";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StackAuthProvider>
      <AuthGate>
        <HouseholdProvider>
          <App />
        </HouseholdProvider>
      </AuthGate>
    </StackAuthProvider>
  </React.StrictMode>,
);

// Installable app (public/sw.js). Production builds only: in dev the worker
// would cache Vite's modules and fight hot reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
