export type ItemStatus = "stocked" | "low" | "out";
export type TagKind = "store" | "section" | "general";

export interface Item {
  id: string;
  name: string;
  quantity: number;
  size: string | null;
  status: ItemStatus;
  notes: string | null;
  updated_at: string;
  tag_ids: string[];
}

export interface Tag {
  id: string;
  name: string;
  kind: TagKind;
  color: string | null;
}

export interface ListSummary {
  id: string;
  name: string;
  status: "active" | "completed";
  created_at: string;
  completed_at: string | null;
  item_count: number;
  checked_count: number;
}

export interface ListItem {
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
  items: ListItem[];
}

export type Role = "owner" | "member";

export interface HouseholdSummary {
  id: string;
  name: string;
  role: Role;
  joined_at: string;
  member_count: number;
  active: boolean;
}

export interface ActiveHousehold {
  id: string;
  name: string;
  role: Role;
}

export interface HouseholdMember {
  user_id: string;
  role: Role;
  joined_at: string;
  email: string;
  display_name: string | null;
}

export interface HouseholdInvite {
  id: string;
  created_at: string;
  expires_at: string;
}

export interface CreatedInvite {
  id: string;
  token: string;
  expiresAt: string;
}

export interface InvitePreview {
  householdName: string;
  inviterName: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body != null) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    let code: string | null = null;
    try {
      const json = JSON.parse(body);
      if (typeof json.error === "string") code = json.error;
    } catch {
      // not JSON — leave code null
    }
    throw new ApiError(res.status, code, `${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // items
  items: () => request<Item[]>(`/items`),
  createItem: (body: Partial<Item> & { name: string; tagIds?: string[] }) =>
    request<{ id: string }>(`/items`, { method: "POST", body: JSON.stringify(body) }),
  updateItem: (id: string, body: Partial<Item> & { tagIds?: string[] }) =>
    request<{ ok: true }>(`/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  setStatus: (id: string, status: ItemStatus) =>
    request<{ ok: true }>(`/items/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  deleteItem: (id: string) => request<{ ok: true }>(`/items/${id}`, { method: "DELETE" }),

  // tags
  tags: () => request<Tag[]>(`/tags`),
  createTag: (body: { name: string; kind: TagKind; color?: string | null }) =>
    request<{ id: string }>(`/tags`, { method: "POST", body: JSON.stringify(body) }),
  updateTag: (id: string, body: Partial<{ name: string; kind: TagKind; color: string | null }>) =>
    request<{ ok: true }>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTag: (id: string) => request<{ ok: true }>(`/tags/${id}`, { method: "DELETE" }),

  // lists
  lists: () => request<ListSummary[]>(`/lists`),
  createList: (body: {
    name?: string;
    itemIds: string[];
    extras: { name: string; quantity: number }[];
  }) => request<{ id: string }>(`/lists`, { method: "POST", body: JSON.stringify(body) }),
  getList: (id: string) => request<ListDetail>(`/lists/${id}`),
  addListItem: (
    listId: string,
    body: { itemId?: string | null; name?: string; quantity?: number },
  ) =>
    request<{ id: string }>(`/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchListItem: (
    listId: string,
    lid: string,
    body: { checkedOff?: boolean; quantity?: number },
  ) =>
    request<{ ok: true }>(`/lists/${listId}/items/${lid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteListItem: (listId: string, lid: string) =>
    request<{ ok: true }>(`/lists/${listId}/items/${lid}`, { method: "DELETE" }),
  finishList: (listId: string, updates: { listItemId: string; quantity: number }[]) =>
    request<{ ok: true }>(`/lists/${listId}/finish`, {
      method: "POST",
      body: JSON.stringify({ updates }),
    }),
  deleteList: (listId: string) =>
    request<{ ok: true }>(`/lists/${listId}`, { method: "DELETE" }),

  // households
  myHousehold: () => request<{ household: ActiveHousehold | null }>(`/me/household`),
  households: () => request<HouseholdSummary[]>(`/households`),
  createHousehold: (body: { name: string }) =>
    request<{ id: string }>(`/households`, { method: "POST", body: JSON.stringify(body) }),
  renameHousehold: (id: string, body: { name: string }) =>
    request<{ ok: true }>(`/households/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteHousehold: (id: string) =>
    request<{ ok: true }>(`/households/${id}`, { method: "DELETE" }),
  activateHousehold: (id: string) =>
    request<{ ok: true }>(`/households/${id}/activate`, { method: "POST" }),
  members: (id: string) => request<HouseholdMember[]>(`/households/${id}/members`),
  removeMember: (householdId: string, userId: string) =>
    request<{ ok: true }>(`/households/${householdId}/members/${userId}`, { method: "DELETE" }),
  invites: (householdId: string) =>
    request<HouseholdInvite[]>(`/households/${householdId}/invites`),
  createInvite: (householdId: string) =>
    request<CreatedInvite>(`/households/${householdId}/invites`, { method: "POST" }),
  revokeInvite: (householdId: string, inviteId: string) =>
    request<{ ok: true }>(`/households/${householdId}/invites/${inviteId}`, { method: "DELETE" }),
  previewInvite: (token: string) => request<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ householdId: string }>(`/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
    }),
};
