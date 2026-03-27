type PulseSeverity = "critical" | "high" | "medium" | "low" | null;

export interface CollectionPulseDay {
  date: string;
  label: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  maxSeverity: PulseSeverity;
  isToday: boolean;
}

export interface CollectionPulseData {
  days: CollectionPulseDay[];
  onlineSources: number;
  configuredSources: number;
  collectionsLast7d: number;
  elevatedDays: number;
  lastCollectionLabel: string | null;
}

const levelClasses: Record<CollectionPulseDay["level"], string> = {
  0: "bg-surface-container-low ring-1 ring-inset ring-outline/25",
  1: "bg-[#d8e5dc]",
  2: "bg-[#aecaaf]",
  3: "bg-[#6ea17e]",
  4: "bg-[#2e6f49]",
};

const severityDotClasses: Record<Exclude<PulseSeverity, null>, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-outline-variant",
};

function dayTitle(day: CollectionPulseDay): string {
  const collectionLabel = `${day.count} ${day.count === 1 ? "collection" : "collections"}`;
  const severityLabel =
    day.maxSeverity ? `, highest severity: ${day.maxSeverity}` : ", no elevated severity";
  return `${day.label}: ${collectionLabel}${severityLabel}`;
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-2">
      <p className="sf-kicker">{label}</p>
      <p className="text-sm font-bold tracking-tight text-on-surface">{value}</p>
    </div>
  );
}

export function CollectionPulse({ pulse }: { pulse: CollectionPulseData }) {
  const hasActivity = pulse.days.some((day) => day.count > 0);
  const visibleDays = pulse.days.slice(-91);

  return (
    <div className="space-y-3">
      <div className="sf-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-headline text-sm font-bold tracking-tight text-on-surface">
            Collection Pulse
          </h4>
          <p className="sf-kicker shrink-0">
            {visibleDays.length > 60 ? `${Math.round(visibleDays.length / 30)}mo` : `${visibleDays.length}d`} activity
          </p>
        </div>

        <div className="mt-3">
          {hasActivity ? (
            <>
              <div className="grid auto-cols-[12px] grid-flow-col grid-rows-7 gap-[2px]">
                {visibleDays.map((day) => (
                  <div
                    key={day.date}
                    title={dayTitle(day)}
                    className={`relative h-3 w-3 rounded-[2px] transition-[box-shadow,filter] duration-150 hover:brightness-90 ${
                      levelClasses[day.level]
                    } ${day.isToday ? "ring-2 ring-inset ring-primary/60" : ""}`}
                    aria-label={dayTitle(day)}
                  >
                    {day.maxSeverity ? (
                      <span
                        className={`absolute bottom-0 right-0 h-1 w-1 rounded-full ${
                          severityDotClasses[day.maxSeverity]
                        }`}
                      />
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
                <div className="flex items-center gap-1.5">
                  <span>Activity</span>
                  <div className="flex items-center gap-0.5">
                    {[0, 1, 2, 3, 4].map((level) => (
                      <span
                        key={level}
                        className={`h-2 w-2 rounded-[2px] ${levelClasses[level as CollectionPulseDay["level"]]}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Severity</span>
                  <div className="flex items-center gap-1">
                    {(["critical", "high", "medium"] as const).map((severity) => (
                      <span
                        key={severity}
                        className={`h-2 w-2 rounded-full ${severityDotClasses[severity]}`}
                        title={severity}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-outline/30 bg-surface-container-low px-3 py-4 text-xs text-on-surface-variant">
              No collection activity yet.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SummaryMetric
          label="Agents"
          value={`${pulse.onlineSources}/${pulse.configuredSources}`}
        />
        <SummaryMetric
          label="7d runs"
          value={String(pulse.collectionsLast7d)}
        />
        <SummaryMetric
          label="Elevated"
          value={`${pulse.elevatedDays}d`}
        />
        <SummaryMetric
          label="Last run"
          value={pulse.lastCollectionLabel ?? "—"}
        />
      </div>
    </div>
  );
}
