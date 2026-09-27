import { z } from "zod";

/**
 * pantry's wire types. Keys are snake_case because they began as Postgres rows
 * and apps/pantry/web/src/api.ts reads exactly these names. The Firestore repo
 * reproduces them; do not rename.
 *
 * Timestamps are strings, but not in the same format on both backends.
 * Postgres returns its text form (`2026-09-27 16:40:17.324351+00`); Firestore
 * returns ISO 8601 (`2026-09-27T16:40:17.324Z`). The SPA only ever passes them
 * to `new Date()`, which parses both, so the difference is invisible to it. Any
 * new consumer that compares or slices these strings must normalise first.
 */

export const ITEM_STATUS = z.enum(["stocked", "low", "out"]);
export const TAG_KIND = z.enum(["store", "section", "general"]);

export type ItemStatus = z.infer<typeof ITEM_STATUS>;
export type TagKind = z.infer<typeof TAG_KIND>;
export type Role = "owner" | "member";

/** The caller's active household, resolved once per request. */
export type HouseholdScope = { householdId: string; role: Role } | null;

export interface HouseholdRef {
  id: string;
  name: string;
}

export interface HouseholdSummaryRow {
  id: string;
  name: string;
  role: Role;
  joined_at: string;
  member_count: number;
  active: boolean;
}

export interface MemberRow {
  user_id: string;
  role: Role;
  joined_at: string;
  email: string;
  display_name: string | null;
}

export interface InviteRow {
  id: string;
  created_at: string;
  expires_at: string;
}

export interface InvitePreviewRow {
  household_name: string;
  inviter_name: string | null;
  inviter_email: string;
  expires_at: string;
  accepted_at: string | null;
}

export type AcceptInviteResult =
  | { ok: true; householdId: string }
  | { ok: false; reason: "invalid" | "used" | "expired" };

export interface ItemRow {
  id: string;
  name: string;
  quantity: number;
  size: string | null;
  status: ItemStatus;
  notes: string | null;
  updated_at: string;
  tag_ids: string[];
}

export interface TagRow {
  id: string;
  name: string;
  kind: TagKind;
  color: string | null;
}

export interface ListSummaryRow {
  id: string;
  name: string;
  status: "active" | "completed";
  created_at: string;
  completed_at: string | null;
  item_count: number;
  checked_count: number;
}

export interface ListItemRow {
  id: string;
  item_id: string | null;
  name_snapshot: string;
  quantity: number;
  checked_off: boolean;
  item_status: ItemStatus | null;
  sections: string[];
  stores: string[];
}

export interface ListDetail {
  id: string;
  name: string;
  status: "active" | "completed";
  created_at: string;
  completed_at: string | null;
  items: ListItemRow[];
}

// ---------- request bodies ----------

export const itemBody = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(0).optional(),
  size: z.string().max(80).nullable().optional(),
  status: ITEM_STATUS.optional(),
  notes: z.string().max(2000).nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});
export type ItemInput = z.infer<typeof itemBody>;

export const itemPatchBody = itemBody.partial();
export type ItemPatch = z.infer<typeof itemPatchBody>;

export const tagBody = z.object({
  name: z.string().min(1).max(80),
  kind: TAG_KIND,
  color: z.string().max(20).nullable().optional(),
});
export type TagInput = z.infer<typeof tagBody>;

export const tagPatchBody = tagBody.partial();
export type TagPatch = z.infer<typeof tagPatchBody>;

export const newListBody = z.object({
  name: z.string().min(1).max(120).optional(),
  itemIds: z.array(z.string().uuid()).default([]),
  extras: z
    .array(
      z.object({ name: z.string().min(1).max(200), quantity: z.number().int().min(1).default(1) }),
    )
    .default([]),
});
export type ListExtra = z.infer<typeof newListBody>["extras"][number];

export const addListItemBody = z.object({
  itemId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().min(1).optional(),
});

export const patchListItemBody = z.object({
  checkedOff: z.boolean().optional(),
  quantity: z.number().int().min(0).optional(),
});
export type ListItemPatch = z.infer<typeof patchListItemBody>;

export const finishBody = z.object({
  updates: z
    .array(
      z.object({
        listItemId: z.string().uuid(),
        quantity: z.number().int().min(0).default(1),
      }),
    )
    .default([]),
});

/** Outcome of an update that can hit a uniqueness rule. */
export type UpdateResult = "ok" | "not_found" | "duplicate";
