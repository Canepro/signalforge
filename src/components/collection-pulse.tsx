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
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-outline/15 bg-surface-container-low px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tracking-tight text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">{hint}</p>
    </div>
  );
}

export function CollectionPulse({ pulse }: { pulse: CollectionPulseData }) {
  const hasActivity = pulse.days.some((day) => day.count > 0);

  return (
    <div className="rounded-lg bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 className="font-headline text-sm font-bold text-on-surface">
            Collection Pulse
          </h4>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-on-surface-variant">
            Last 42 days of collection activity. Darker cells mean more collected runs.
            Severity stays separate as a small overlay so activity and risk do not blur together.
          </p>
        </div>
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-on-surface-variant">
          Daily collections with severity overlays
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {hasActivity ? (
            <>
              <div className="overflow-x-auto pb-1">
                <div className="grid min-w-max auto-cols-max grid-flow-col grid-rows-7 gap-1">
                  {pulse.days.map((day) => (
                    <div
                      key={day.date}
                      title={dayTitle(day)}
                      className={`relative h-4 w-4 rounded-[4px] transition-transform hover:scale-110 ${
                        levelClasses[day.level]
                      } ${day.isToday ? "ring-2 ring-inset ring-primary/60" : ""}`}
                      aria-label={dayTitle(day)}
                    >
                      {day.maxSeverity ? (
                        <span
                          className={`absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ${
                            severityDotClasses[day.maxSeverity]
                          }`}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-on-surface-variant">
                <div className="flex items-center gap-2">
                  <span>Collections</span>
                  <div className="flex items-center gap-1">
                    {[0, 1, 2, 3, 4].map((level) => (
                      <span
                        key={level}
                        className={`h-2.5 w-2.5 rounded-[3px] ${levelClasses[level as CollectionPulseDay["level"]]}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span>Severity overlay</span>
                  <div className="flex items-center gap-1.5">
                    {(["critical", "high", "medium"] as const).map((severity) => (
                      <span
                        key={severity}
                        className={`h-2.5 w-2.5 rounded-full ${severityDotClasses[severity]}`}
                        title={severity}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-outline/30 bg-surface-container-low px-4 py-6 text-[11px] text-on-surface-variant">
              No collection activity yet. Once runs arrive, this view will show daily collection density and which days produced elevated findings.
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 xl:w-72 xl:grid-cols-1">
          <SummaryMetric
            label="Live agents"
            value={`${pulse.onlineSources}/${pulse.configuredSources}`}
            hint="Enabled sources with enrolled agents currently heartbeating."
          />
          <SummaryMetric
            label="Collections 7d"
            value={String(pulse.collectionsLast7d)}
            hint="Runs created over the last seven days."
          />
          <SummaryMetric
            label="Elevated days"
            value={String(pulse.elevatedDays)}
            hint="Days with at least one high or critical run."
          />
          <SummaryMetric
            label="Last collection"
            value={pulse.lastCollectionLabel ?? "None"}
            hint="Most recent collected run in this dashboard window."
          />
        </div>
      </div>
    </div>
  );
}
