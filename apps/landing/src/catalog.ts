/**
 * Every app the landing page lists. Adding an app to the stack means adding
 * it here; its URL is worked out at build time (see ./urls.ts), so this file
 * holds only what a visitor reads.
 *
 * `id` is the app's directory under apps/ and its Firebase Hosting target.
 */
export interface CatalogApp {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Accent colour for the card. */
  accent: string;
  /** Self-hosted port, from docker-compose.yml. Used when nothing else says where the app lives. */
  localPort: number;
}

export const catalog: CatalogApp[] = [
  {
    id: "crate",
    name: "Crate",
    tagline: "Your album queue",
    description: "Save albums you mean to hear, then let Crate pick what to put on next.",
    accent: "#fb7185",
    localPort: 3101,
  },
  {
    id: "pantry",
    name: "Pantry",
    tagline: "Kitchen inventory and grocery lists",
    description: "Track what's stocked, low or out, and turn it into a shopping list the whole household shares.",
    accent: "#34d399",
    localPort: 3102,
  },
  {
    id: "ytdigest",
    name: "YouTube Digest",
    tagline: "New uploads, by email",
    description: "Follow channels and get one daily or weekly email with the videos worth your time.",
    accent: "#f59e0b",
    localPort: 3103,
  },
];
