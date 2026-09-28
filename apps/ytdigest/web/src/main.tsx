import React from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "@stack/auth-ui";
import { StackAuthProvider } from "./authProvider";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StackAuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </StackAuthProvider>
  </React.StrictMode>,
);
