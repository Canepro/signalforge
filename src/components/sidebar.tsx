"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  onUploadClick?: () => void;
  /** Opens external-collection guide (copyable commands); collection still runs outside SignalForge. */
  onCollectEvidenceClick?: () => void;
}

type NavItem = {
  href: string;
  label: string;
  icon: string;
  disabled?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Runs", icon: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" },
  { href: "/sources", label: "Sources", icon: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" },
];

export function Sidebar({ onUploadClick, onCollectEvidenceClick }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-outline-variant/15 bg-surface-container-low md:flex">
      {/* Logo */}
      <div className="border-b border-outline-variant/10 px-4 pb-5 pt-5">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-on-primary shadow-sm">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
              <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
            </svg>
          </div>
          <div>
            <div className="font-headline text-sm font-bold leading-tight text-on-surface">
              SignalForge
            </div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
              Infrastructure Diagnostics
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`sf-shell-link ${
                isActive
                  ? "bg-surface-container-lowest text-on-surface shadow-sm ring-1 ring-inset ring-outline-variant/10"
                  : "text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface"
              }`}
            >
              <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="mt-auto space-y-2 border-t border-outline-variant/10 px-3 pb-4 pt-4">
        <button
          type="button"
          onClick={onUploadClick}
          className="sf-btn-primary w-full"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload artifact
        </button>
        {onCollectEvidenceClick ? (
          <button
            type="button"
            onClick={onCollectEvidenceClick}
            className="sf-btn-secondary w-full"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            How to collect
          </button>
        ) : null}
      </div>
    </aside>
  );
}
