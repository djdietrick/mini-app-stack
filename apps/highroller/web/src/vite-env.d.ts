/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "stack" (default) or "firebase". Selects the auth provider at build time. */
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  /** Set only when running against the Firebase emulator suite. */
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
