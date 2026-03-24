import Link from "next/link";

export default function RunNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        Run Not Found
      </h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        The requested analysis run could not be found.
      </p>
      <Link
        href="/"
        className="mt-4 rounded-md bg-gradient-to-b from-primary to-primary-dim px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90 transition-all"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
