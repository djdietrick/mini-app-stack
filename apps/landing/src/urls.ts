/**
 * Works out where each app lives, at build time. In order:
 *
 *   1. VITE_APP_URL_<ID>, e.g. VITE_APP_URL_CRATE — a custom domain, or any
 *      self-hosted address.
 *   2. The app's Firebase Hosting site for VITE_FIREBASE_PROJECT_ID, read from
 *      the `targets` in .firebaserc: https://<site>.web.app. This is what CI
 *      uses, so the deploys need no per-app variables.
 *   3. http://localhost:<port>, the self-hosted Docker stack's port.
 *
 * Kept free of Vite and Node APIs so it can be unit-tested directly.
 */
export interface FirebaseRc {
  targets?: Record<string, { hosting?: Record<string, string[]> }>;
}

export interface UrlSource {
  id: string;
  localPort: number;
}

export function resolveAppUrls(
  apps: UrlSource[],
  env: Record<string, string | undefined>,
  firebaserc: FirebaseRc | null,
): Record<string, string> {
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const hosting = projectId ? firebaserc?.targets?.[projectId]?.hosting : undefined;

  const urls: Record<string, string> = {};
  for (const app of apps) {
    const override = env[`VITE_APP_URL_${app.id.toUpperCase()}`];
    const site = hosting?.[app.id]?.[0];
    urls[app.id] = override
      ? override.replace(/\/+$/, "")
      : site
        ? `https://${site}.web.app`
        : `http://localhost:${app.localPort}`;
  }
  return urls;
}
