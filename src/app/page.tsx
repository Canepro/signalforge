import Link from "next/link";

export default function PublicLandingPage() {
  return (
    <main className="min-h-full bg-surface text-on-surface">
      <section className="border-b border-outline-variant/15 bg-surface-container-low">
        <div className="mx-auto flex min-h-[82vh] max-w-6xl flex-col justify-center px-6 py-16 sm:px-8 lg:px-10">
          <div className="max-w-3xl">
            <p className="sf-kicker">SignalForge</p>
            <h1 className="mt-4 font-headline text-4xl font-bold tracking-tight text-on-surface sm:text-5xl lg:text-6xl">
              Infrastructure Diagnostics
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-on-surface-variant sm:text-lg">
              Evidence-to-findings diagnostics for operator-owned machines,
              clusters, containers, and source-bound automation. Operational
              data, run history, and collection controls require authorized
              access.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/sources/login" className="sf-btn-primary">
                Operator sign in
              </Link>
              <span className="text-sm font-medium text-on-surface-variant">
                Public access is limited to this page.
              </span>
            </div>
          </div>

          <div className="mt-14 grid gap-4 border-t border-outline-variant/15 pt-8 sm:grid-cols-3">
            <div>
              <div className="sf-kicker">Input</div>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                Externally collected evidence artifacts.
              </p>
            </div>
            <div>
              <div className="sf-kicker">Analysis</div>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                Deterministic findings with bounded model enrichment.
              </p>
            </div>
            <div>
              <div className="sf-kicker">Access</div>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                Operator sessions and source-bound API tokens.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
