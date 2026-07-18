export type Cadence = "daily" | "weekly";
export type NotifyMode = "all" | "rules";

export interface Channel {
  id: string;
  youtube_channel_id: string;
  title: string;
  thumbnail_url: string | null;
  last_polled_at: string | null;
  subscription_id: string | null;
}

export interface ResolvedChannel {
  youtubeChannelId: string;
  title: string;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string;
}

export interface Subscription {
  id: string;
  channel_id: string;
  channel_title: string;
  thumbnail_url: string | null;
  cadence: Cadence;
  digest_day_of_week: number | null;
  notify_mode: NotifyMode;
  last_digested_at: string | null;
  created_at: string;
}

export type ConditionType = "keyword" | "performance" | "engagement" | "duration";

export interface Rule {
  id: string;
  scope: "subscription" | "global";
  subscription_id: string | null;
  name: string;
  rule_json: RuleGroup;
  enabled: boolean;
  created_at: string;
}

export interface RuleGroup {
  op: "AND" | "OR";
  conditions: RuleCondition[];
}

export type RuleCondition =
  | { type: "keyword"; field: "title" | "description"; match: "any" | "all" | "none"; terms: string[] }
  | { type: "performance"; metric: "views_per_hour"; comparedTo: "channel_baseline"; threshold: number }
  | { type: "engagement"; metric: "like_ratio"; comparedTo: "channel_baseline"; threshold: number }
  | { type: "duration"; min?: number; max?: number };

export interface DigestRun {
  id: string;
  cadence: Cadence;
  run_date: string;
  sent_at: string | null;
  item_count: number;
}

export interface DigestItem {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  channel_title: string;
  matched_rule_id: string | null;
  reason_json: string[] | null;
}

export interface DigestDetail extends DigestRun {
  items: DigestItem[];
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
  channels: () => request<Channel[]>(`/channels`),
  resolveChannel: (query: string) =>
    request<ResolvedChannel>(`/channels/resolve`, { method: "POST", body: JSON.stringify({ query }) }),

  subscriptions: () => request<Subscription[]>(`/subscriptions`),
  createSubscription: (body: {
    query: string;
    cadence: Cadence;
    digestDayOfWeek?: number;
    notifyMode: NotifyMode;
  }) => request<{ id: string; channelId: string }>(`/subscriptions`, { method: "POST", body: JSON.stringify(body) }),
  updateSubscription: (
    id: string,
    body: Partial<{ cadence: Cadence; digestDayOfWeek: number | null; notifyMode: NotifyMode }>,
  ) => request<{ ok: true }>(`/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSubscription: (id: string) => request<{ ok: true }>(`/subscriptions/${id}`, { method: "DELETE" }),

  rules: () => request<Rule[]>(`/rules`),
  createRule: (body: {
    scope: "subscription" | "global";
    subscriptionId?: string;
    name: string;
    ruleJson: RuleGroup;
    enabled?: boolean;
  }) => request<{ id: string }>(`/rules`, { method: "POST", body: JSON.stringify(body) }),
  updateRule: (id: string, body: Partial<{ name: string; ruleJson: RuleGroup; enabled: boolean }>) =>
    request<{ ok: true }>(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRule: (id: string) => request<{ ok: true }>(`/rules/${id}`, { method: "DELETE" }),

  digests: () => request<DigestRun[]>(`/digests`),
  digest: (id: string) => request<DigestDetail>(`/digests/${id}`),
  runDigestNow: () => request<{ sent: boolean; itemCount: number }>(`/digests/run-now`, { method: "POST" }),
};
