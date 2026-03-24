import Link from "next/link";
import { SourceHealthDot } from "@/components/source-health-dot";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default async function SourcesListPage() {
  const storage = await getStorage();
  const sources = await storage.sources.list();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface tracking-tight">Evidence sources</h1>
          <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
            Register a target, request collection jobs, and enroll a thin agent.
            Jobs stay <strong>queued</strong> until an external agent claims them.
          </p>
        </div>
        <Link
          href="/sources/new"
          className="group inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary shadow-md hover:shadow-lg hover:brightness-110 transition-all"
        >
          <svg className="h-4 w-4 transition-transform group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New source
        </Link>
      </div>

      {sources.length === 0 ? (
        <div className="relative rounded-xl border border-dashed border-outline-variant/40 p-16 text-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent pointer-events-none" />
          <div className="relative">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container-high shadow-inner">
              <svg className="h-7 w-7 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </div>
            <p className="text-sm text-on-surface-variant">
              No sources yet. Create one to use <span className="font-semibold text-on-surface">Collect Fresh Evidence</span>.
            </p>
            <p className="text-[10px] text-outline-variant mt-1">
              A source represents a target machine or environment you want to monitor.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
          <div className="px-5 py-3 flex items-center justify-between border-b border-outline-variant/15 bg-surface-container-low/50">
            <h2 className="font-headline font-bold text-on-surface text-sm tracking-tight">Registered Sources</h2>
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
          </div>
          <ul className="divide-y divide-outline-variant/10">
            {sources.map((s, i) => (
              <li key={s.id} style={{ animationDelay: `${i * 50}ms` }} className="animate-[fadeIn_0.3s_ease_both]">
                <Link
                  href={`/sources/${s.id}`}
                  className="group flex items-center gap-4 px-5 py-4 hover:bg-primary/[0.03] transition-all duration-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                        {s.display_name}
                      </span>
                      {!s.enabled && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded-md">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-on-surface-variant mt-0.5 font-mono truncate">{s.target_identifier}</div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-outline">
                      <span>{s.source_type}</span>
                      <span className="text-outline-variant/50">·</span>
                      <span>{s.expected_artifact_type}</span>
                      {s.last_seen_at && (
                        <>
                          <span className="text-outline-variant/50">·</span>
                          <span>seen {relativeTime(s.last_seen_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <SourceHealthDot status={s.health_status} />
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-outline-variant group-hover:text-primary group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
