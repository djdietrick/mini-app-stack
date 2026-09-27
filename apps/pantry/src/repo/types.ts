import type { Closable } from "@stack/service-kit";
import type {
  AcceptInviteResult,
  HouseholdRef,
  HouseholdScope,
  HouseholdSummaryRow,
  InvitePreviewRow,
  InviteRow,
  ItemInput,
  ItemPatch,
  ItemRow,
  ItemStatus,
  ListDetail,
  ListExtra,
  ListItemPatch,
  ListSummaryRow,
  MemberRow,
  Role,
  TagInput,
  TagPatch,
  TagRow,
  UpdateResult,
} from "../domain/types.js";

/**
 * pantry's data port. Implemented by postgres.ts (self-hosted) and
 * firestore.ts (cloud); src/domain depends only on this.
 *
 * Authorisation (owner-only, must-be-a-member, must-have-a-household) lives in
 * the routes, not here. The repo's job is data, scoped by `householdId` in the
 * query itself so a caller can never reach another household's rows by id.
 *
 * Mutations report "did it match" rather than throwing, so the route owns the
 * 404. Methods that can trip a uniqueness rule return null or "duplicate" for
 * the route to turn into a 409, because neither backend should leak its own
 * error shape (Postgres 23505, a Firestore transaction) upward.
 */
export interface PantryRepo extends Closable {
  // ---------- households ----------

  /** The caller's active household, if it points at one they still belong to. */
  activeHousehold(userId: string): Promise<HouseholdScope>;
  /** Membership regardless of which household is active. */
  memberRole(userId: string, householdId: string): Promise<Role | null>;
  getHousehold(householdId: string): Promise<HouseholdRef | null>;
  listHouseholds(userId: string): Promise<HouseholdSummaryRow[]>;
  /** Creates it, makes the caller its owner, and makes it their active one. */
  createHousehold(userId: string, name: string): Promise<string>;
  renameHousehold(householdId: string, name: string): Promise<void>;
  /** Removes the household and everything scoped to it. */
  deleteHousehold(householdId: string): Promise<void>;
  setActiveHousehold(userId: string, householdId: string): Promise<void>;
  listMembers(householdId: string): Promise<MemberRow[]>;
  /**
   * Drops the membership; deletes the household if it is now empty; promotes
   * the longest-standing member if the owner left; and repoints the removed
   * user's active household if it was this one.
   */
  removeMember(householdId: string, userId: string, targetRole: Role): Promise<void>;

  // ---------- invites ----------

  listInvites(householdId: string): Promise<InviteRow[]>;
  createInvite(
    householdId: string,
    tokenHash: Buffer,
    createdBy: string,
    ttlDays: number,
  ): Promise<{ id: string; expires_at: string }>;
  revokeInvite(householdId: string, inviteId: string): Promise<void>;
  previewInvite(tokenHash: Buffer): Promise<InvitePreviewRow | null>;
  /** Validates and consumes the invite atomically; single use. */
  acceptInvite(tokenHash: Buffer, userId: string): Promise<AcceptInviteResult>;

  // ---------- items ----------

  listItems(householdId: string): Promise<ItemRow[]>;
  /** null when the household already has an item with this name. */
  createItem(householdId: string, input: ItemInput): Promise<string | null>;
  updateItem(householdId: string, id: string, patch: ItemPatch): Promise<UpdateResult>;
  setItemStatus(householdId: string, id: string, status: ItemStatus): Promise<boolean>;
  deleteItem(householdId: string, id: string): Promise<boolean>;

  // ---------- tags ----------

  listTags(householdId: string): Promise<TagRow[]>;
  /** null when the household already has a tag of this kind and name. */
  createTag(householdId: string, input: TagInput): Promise<string | null>;
  /** Callers skip this for an empty patch, matching the original no-op. */
  updateTag(householdId: string, id: string, patch: TagPatch): Promise<UpdateResult>;
  deleteTag(householdId: string, id: string): Promise<boolean>;

  // ---------- grocery lists ----------

  listLists(householdId: string): Promise<ListSummaryRow[]>;
  createList(
    householdId: string,
    name: string,
    itemIds: string[],
    extras: ListExtra[],
  ): Promise<string>;
  getList(householdId: string, listId: string): Promise<ListDetail | null>;
  listExists(householdId: string, listId: string): Promise<boolean>;
  /** The inventory item's name, for a list entry's snapshot. */
  itemName(householdId: string, itemId: string): Promise<string | null>;
  addListItem(
    listId: string,
    itemId: string | null,
    nameSnapshot: string,
    quantity: number,
  ): Promise<string>;
  /** Callers skip this for an empty patch, matching the original no-op. */
  patchListItem(
    householdId: string,
    listId: string,
    listItemId: string,
    patch: ListItemPatch,
  ): Promise<boolean>;
  deleteListItem(householdId: string, listId: string, listItemId: string): Promise<boolean>;
  /**
   * Writes each checked-off entry's quantity (explicit, else 1) to the entry
   * and to its linked inventory item, flips that item to `stocked`, and marks
   * the list completed — all or nothing. False when the list is not found.
   */
  finishList(
    householdId: string,
    listId: string,
    quantities: Map<string, number>,
  ): Promise<boolean>;
  deleteList(householdId: string, listId: string): Promise<boolean>;
}
