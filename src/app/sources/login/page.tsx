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
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-surface text-on-surface">
      <div className="w-full max-w-md rounded-xl border border-outline-variant/30 bg-surface-container-low p-6 shadow-sm space-y-4">
        <h1 className="font-headline text-xl font-bold">Sources — admin sign-in</h1>
        <p className="text-sm text-on-surface-variant">
          Enter the same value as <code className="text-xs bg-surface-container px-1 rounded">SIGNALFORGE_ADMIN_TOKEN</code>{" "}
          from the server environment. The token is never sent to the browser bundle; only this form posts it to the
          server over HTTPS in production.
        </p>
        {sp.unconfigured === "1" ? (
          <p className="text-sm text-amber-700 dark:text-amber-300 rounded-md bg-amber-500/10 px-3 py-2">
            <strong>Not configured.</strong> Set <code className="text-xs">SIGNALFORGE_ADMIN_TOKEN</code> and restart
            the app, then try again.
          </p>
        ) : null}
        {sp.error === "1" ? (
          <p className="text-sm text-red-700 dark:text-red-300 rounded-md bg-red-500/10 px-3 py-2">
            Invalid token. Try again.
          </p>
        ) : null}
        <form action={loginAdminAction} className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
            Admin token
            <input
              type="password"
              name="token"
              required
              autoComplete="off"
              className="mt-1 block w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-primary text-on-primary py-2.5 text-sm font-bold uppercase tracking-wide hover:opacity-90"
          >
            Sign in
          </button>
        </form>
        <p className="text-xs text-on-surface-variant">
          <Link href="/" className="underline hover:text-on-surface">
            Back to Runs
          </Link>
        </p>
      </div>
    </div>
  );
}
