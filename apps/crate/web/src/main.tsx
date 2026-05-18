import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider, AuthGate } from "@stack/auth-ui";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider authUrl="/auth">
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>,
);
