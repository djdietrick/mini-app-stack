import type { RuleCondition, RuleGroup } from "../api";

const DEFAULT_CONDITION: Record<RuleCondition["type"], RuleCondition> = {
  keyword: { type: "keyword", field: "title", match: "any", terms: [""] },
  performance: { type: "performance", metric: "views_per_hour", comparedTo: "channel_baseline", threshold: 1.5 },
  engagement: { type: "engagement", metric: "like_ratio", comparedTo: "channel_baseline", threshold: 1.5 },
  duration: { type: "duration", min: undefined, max: undefined },
};

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  onChange: (c: RuleCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-canvas-200 bg-white p-3">
      <select
        className="rounded border border-canvas-200 px-2 py-1 text-sm"
        value={condition.type}
        onChange={(e) => onChange(DEFAULT_CONDITION[e.target.value as RuleCondition["type"]])}
      >
        <option value="keyword">Keyword</option>
        <option value="performance">Performance (views/hour)</option>
        <option value="engagement">Engagement (like ratio)</option>
        <option value="duration">Duration</option>
      </select>

      {condition.type === "keyword" && (
        <>
          <select
            className="rounded border border-canvas-200 px-2 py-1 text-sm"
            value={condition.field}
            onChange={(e) => onChange({ ...condition, field: e.target.value as "title" | "description" })}
          >
            <option value="title">title</option>
            <option value="description">description</option>
          </select>
          <select
            className="rounded border border-canvas-200 px-2 py-1 text-sm"
            value={condition.match}
            onChange={(e) => onChange({ ...condition, match: e.target.value as "any" | "all" | "none" })}
          >
            <option value="any">contains any of</option>
            <option value="all">contains all of</option>
            <option value="none">contains none of</option>
          </select>
          <input
            className="min-w-48 flex-1 rounded border border-canvas-200 px-2 py-1 text-sm"
            placeholder="comma, separated, terms"
            value={condition.terms.join(", ")}
            onChange={(e) =>
              onChange({ ...condition, terms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
            }
          />
        </>
      )}

      {(condition.type === "performance" || condition.type === "engagement") && (
        <>
          <span className="text-sm text-ink-muted">at least</span>
          <input
            type="number"
            step="0.1"
            min="0"
            className="w-20 rounded border border-canvas-200 px-2 py-1 text-sm"
            value={condition.threshold}
            onChange={(e) => onChange({ ...condition, threshold: Number(e.target.value) })}
          />
          <span className="text-sm text-ink-muted">
            x this channel's usual {condition.type === "performance" ? "pace" : "engagement"}
          </span>
        </>
      )}

      {condition.type === "duration" && (
        <>
          <span className="text-sm text-ink-muted">between</span>
          <input
            type="number"
            min="0"
            className="w-24 rounded border border-canvas-200 px-2 py-1 text-sm"
            placeholder="min sec"
            value={condition.min ?? ""}
            onChange={(e) => onChange({ ...condition, min: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-sm text-ink-muted">and</span>
          <input
            type="number"
            min="0"
            className="w-24 rounded border border-canvas-200 px-2 py-1 text-sm"
            placeholder="max sec"
            value={condition.max ?? ""}
            onChange={(e) => onChange({ ...condition, max: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-sm text-ink-muted">seconds</span>
        </>
      )}

      <button type="button" className="ml-auto text-sm text-brand-500 hover:underline" onClick={onRemove}>
        remove
      </button>
    </div>
  );
}

export function RuleConditionEditor({
  group,
  onChange,
}: {
  group: RuleGroup;
  onChange: (g: RuleGroup) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-muted">Match</span>
        <select
          className="rounded border border-canvas-200 px-2 py-1"
          value={group.op}
          onChange={(e) => onChange({ ...group, op: e.target.value as "AND" | "OR" })}
        >
          <option value="OR">any</option>
          <option value="AND">all</option>
        </select>
        <span className="text-ink-muted">of these conditions:</span>
      </div>

      {group.conditions.map((condition, i) => (
        <ConditionRow
          key={i}
          condition={condition}
          onChange={(c) => {
            const next = [...group.conditions];
            next[i] = c;
            onChange({ ...group, conditions: next });
          }}
          onRemove={() => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
        />
      ))}

      <button
        type="button"
        className="text-sm text-brand-500 hover:underline"
        onClick={() => onChange({ ...group, conditions: [...group.conditions, DEFAULT_CONDITION.keyword] })}
      >
        + add condition
      </button>
    </div>
  );
}
