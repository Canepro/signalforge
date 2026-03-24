import Link from "next/link";
import { createSourceAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <Link href="/sources" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All sources
        </Link>
        <h1 className="font-headline text-2xl font-bold text-on-surface mt-3 tracking-tight">New source</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Register a target that an external agent will collect evidence from.
        </p>
      </div>

      {sp.error === "duplicate" && (
        <p className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
          A source with this <code className="text-xs">target_identifier</code> already exists (among enabled sources).
        </p>
      )}
      {(sp.error === "missing" || sp.error === "type") && (
        <p className="text-sm text-red-700 dark:text-red-300 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2.5">
          Please fill all required fields and pick a valid source type.
        </p>
      )}

      <form action={createSourceAction} className="relative rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm space-y-5 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/60 to-transparent" />
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Display name</span>
          <input
            name="display_name"
            required
            maxLength={256}
            placeholder="e.g. Prod Web-01"
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Target identifier</span>
          <input
            name="target_identifier"
            required
            maxLength={512}
            placeholder="e.g. prod-web-01 or host:myserver"
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm font-mono text-on-surface placeholder:text-outline-variant focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          />
          <span className="text-[10px] text-on-surface-variant mt-1 block leading-snug">
            Stable key for compare / drift. Must match <code className="text-[10px] font-mono bg-surface-container px-1 py-0.5 rounded">target_identifier</code>{" "}
            in uploaded run metadata.
          </span>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Source type</span>
          <select
            name="source_type"
            required
            className="mt-1.5 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-sm text-on-surface focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
          >
            <option value="linux_host">linux_host</option>
            <option value="wsl">wsl</option>
          </select>
        </label>
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-b from-primary to-primary-dim px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary shadow-md hover:shadow-lg hover:brightness-110 transition-all"
          >
            Create source
          </button>
          <Link
            href="/sources"
            className="rounded-lg border border-outline-variant/30 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container-high transition-all"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
