import { lazy, Suspense, type ReactNode } from "react";
import { AuthProvider } from "@stack/auth-ui";

/**
 * Loaded only in the Firebase build, and only through this conditional.
 *
 * A plain static import is not enough to keep the Firebase SDK out of the
 * self-hosted bundle. Vite folds the mode check and drops the dead branch, but
 * the SDK's module-level side effects keep it in the bundle regardless, adding
 * about 90 kB. With the condition around the dynamic import, the self-hosted
 * build has no import to follow at all.
 */
const FirebaseAuthProvider =
  import.meta.env.VITE_AUTH_MODE === "firebase"
    ? lazy(() =>
        import("@stack/auth-ui/firebase").then((m) => ({ default: m.FirebaseAuthProvider })),
      )
    : null;

/**
 * Picks the identity backend at build time.
 *
 *   VITE_AUTH_MODE=stack     (default) apps/auth behind the /auth proxy
 *   VITE_AUTH_MODE=firebase            Firebase Auth + the authApi function
 *
 * Both render the same context, so nothing downstream of here changes.
 */
export function StackAuthProvider({ children }: { children: ReactNode }) {
  if (FirebaseAuthProvider) {
    return (
      <Suspense fallback={null}>
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
      </Suspense>
    );
  }

  return <AuthProvider authUrl="/auth">{children}</AuthProvider>;
}
