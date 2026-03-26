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
  { href: "#", label: "Findings", icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", disabled: true },
  { href: "#", label: "Artifacts", icon: "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z", disabled: true },
];

export function Sidebar({ onUploadClick, onCollectEvidenceClick }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-60 flex-col h-full border-r border-surface-container bg-surface-container-low shrink-0">
      {/* Logo */}
      <div className="px-4 pt-5 pb-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
              <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
            </svg>
          </div>
          <div>
            <div className="font-headline text-sm font-bold text-on-surface leading-tight">
              SignalForge
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Infrastructure Diagnostics
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const isDisabled = item.disabled;
          return (
            <Link
              key={item.label}
              href={isDisabled ? "#" : item.href}
              className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "bg-surface-container-lowest text-on-surface font-semibold shadow-sm"
                  : isDisabled
                    ? "text-outline-variant cursor-default"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50"
              }`}
              aria-disabled={isDisabled}
              tabIndex={isDisabled ? -1 : undefined}
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
      <div className="mt-auto px-3 pb-4 pt-3 border-t border-surface-container space-y-2">
        <button
          onClick={onUploadClick}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-b from-primary to-primary-dim px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-on-primary hover:opacity-90 transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Upload Artifact
        </button>
        {onCollectEvidenceClick ? (
          <button
            type="button"
            onClick={onCollectEvidenceClick}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface hover:bg-surface-container-high transition-all"
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
