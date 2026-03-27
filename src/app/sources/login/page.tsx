import Link from "next/link";
import { loginAdminAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SourcesLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; unconfigured?: string }>;
}) {
  const sp = await searchParams;

  return (
    <div className="min-h-full bg-surface px-6 py-10 text-on-surface">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="sf-panel p-7 lg:p-8">
            <p className="sf-kicker">Admin access</p>
            <h1 className="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">
              Sources sign-in
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
              Enter the same value as <code className="sf-inline-code">SIGNALFORGE_ADMIN_TOKEN</code> from the server
              environment. The token stays server-side. This form posts it directly to the app and establishes the
              httpOnly session used for Sources management.
            </p>
            <div className="mt-6 rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4">
              <div className="sf-kicker">What this unlocks</div>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-on-surface-variant">
                <p>Register and manage live sources.</p>
                <p>Queue collection jobs and inspect agent enrollment details.</p>
                <p>Review source health, defaults, and job history in the operator shell.</p>
              </div>
            </div>
          </div>

          <div className="sf-panel p-6 lg:p-7">
            <div className="space-y-4">
              <div>
                <div className="sf-kicker">Session</div>
                <h2 className="mt-2 font-headline text-xl font-bold text-on-surface">
                  Sign in to Sources
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                  Use the same admin token configured on the server. In production, submit this over HTTPS only.
                </p>
              </div>

        {sp.unconfigured === "1" ? (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                  <strong>Not configured.</strong> Set <code className="sf-inline-code">SIGNALFORGE_ADMIN_TOKEN</code>,
                  restart the app, then try again.
                </p>
        ) : null}
        {sp.error === "1" ? (
                <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  Invalid token. Try again.
                </p>
        ) : null}
              <form action={loginAdminAction} className="space-y-4">
                <label className="block">
                  <span className="sf-field-label">Admin token</span>
                  <input
                    type="password"
                    name="token"
                    required
                    autoComplete="off"
                    className="sf-field"
                  />
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="submit"
                    className="sf-btn-primary"
                  >
                    Sign in
                  </button>
                  <Link href="/" className="sf-btn-ghost px-0 text-sm text-on-surface-variant hover:bg-transparent">
                    Back to runs
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
