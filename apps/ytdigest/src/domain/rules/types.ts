export interface KeywordCondition {
  type: "keyword";
  field: "title" | "description";
  match: "any" | "all" | "none";
  terms: string[];
}

export interface PerformanceCondition {
  type: "performance";
  metric: "views_per_hour";
  comparedTo: "channel_baseline";
  /** Multiplier over the channel's baseline, e.g. 1.5 = 1.5x the usual pace. */
  threshold: number;
}

export interface EngagementCondition {
  type: "engagement";
  metric: "like_ratio";
  comparedTo: "channel_baseline";
  threshold: number;
}

export interface DurationCondition {
  type: "duration";
  min?: number;
  max?: number;
}

export type Condition =
  | KeywordCondition
  | PerformanceCondition
  | EngagementCondition
  | DurationCondition;

export interface RuleGroup {
  op: "AND" | "OR";
  conditions: (Condition | RuleGroup)[];
}

export function isRuleGroup(node: Condition | RuleGroup): node is RuleGroup {
  return "op" in node;
}
