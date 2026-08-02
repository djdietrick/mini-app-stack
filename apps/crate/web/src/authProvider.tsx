import type { ReactNode } from "react";
import { AuthProvider } from "@stack/auth-ui";
import { FirebaseAuthProvider } from "@stack/auth-ui/firebase";

/**
 * Picks the identity backend at build time.
 *
 *   VITE_AUTH_MODE=stack     (default) apps/auth behind the /auth proxy
 *   VITE_AUTH_MODE=firebase            Firebase Auth + the authApi function
 *
 * Both render the same context, so nothing downstream of here changes.
 * Vite tree-shakes the unused branch, so the Firebase SDK is not shipped in
 * the self-hosted bundle.
 */
export function StackAuthProvider({ children }: { children: ReactNode }) {
  if (import.meta.env.VITE_AUTH_MODE === "firebase") {
    return (
      <FirebaseAuthProvider
        config={{
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        }}
        emulatorHost={import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST}
      >
        {children}
      </FirebaseAuthProvider>
    );
  }

  return <AuthProvider authUrl="/auth">{children}</AuthProvider>;
}
