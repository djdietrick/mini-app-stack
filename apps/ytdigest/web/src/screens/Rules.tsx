import { useEffect, useState } from "react";
import { api, type Rule, type RuleGroup, type Subscription } from "../api";
import { RuleConditionEditor } from "../components/RuleConditionEditor";

const EMPTY_GROUP: RuleGroup = { op: "OR", conditions: [] };

export function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [scope, setScope] = useState<"global" | string>("global");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<RuleGroup>(EMPTY_GROUP);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([api.rules().then(setRules), api.subscriptions().then(setSubs)]);
  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || group.conditions.length === 0) return;
    setError(null);
    try {
      await api.createRule({
        scope: scope === "global" ? "global" : "subscription",
        subscriptionId: scope === "global" ? undefined : scope,
        name: name.trim(),
        ruleJson: group,
      });
      setName("");
      setGroup(EMPTY_GROUP);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create rule");
    }
  };

  const subTitle = (id: string | null) => subs.find((s) => s.channel_id === id || s.id === id)?.channel_title;

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded border border-canvas-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-ink-muted">Applies to</label>
            <select
              className="mt-1 rounded border border-canvas-200 px-2 py-1.5"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="global">All channels</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.channel_title}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-ink-muted">Rule name</label>
            <input
              className="mt-1 w-full rounded border border-canvas-200 px-2 py-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trending react content"
            />
          </div>
        </div>

        <RuleConditionEditor group={group} onChange={setGroup} />

        <button type="submit" className="rounded bg-brand-500 px-4 py-1.5 text-white hover:bg-brand-600">
          Save rule
        </button>
        {error && <p className="text-sm text-brand-600">{error}</p>}
      </form>

      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="rounded border border-canvas-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <span className="rounded-full bg-canvas-100 px-2 py-0.5 text-xs text-ink-muted">
                {r.scope === "global" ? "all channels" : subTitle(r.subscription_id) ?? "channel"}
              </span>
              <label className="ml-auto flex items-center gap-1 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={async (e) => {
                    await api.updateRule(r.id, { enabled: e.target.checked });
                    load();
                  }}
                />
                enabled
              </label>
              <button
                className="text-sm text-brand-500 hover:underline"
                onClick={async () => {
                  await api.deleteRule(r.id);
                  load();
                }}
              >
                delete
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {r.rule_json.op === "AND" ? "all" : "any"} of {r.rule_json.conditions.length} condition
              {r.rule_json.conditions.length === 1 ? "" : "s"}
            </p>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-ink-muted">No rules yet — subscriptions in "matches only" mode need at least one rule to ever notify you.</p>}
      </div>
    </div>
  );
}
