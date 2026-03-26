"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ThemeToggle } from "./theme-toggle";
import { NAV_ITEMS } from "./sidebar";

interface TopBarProps {
  breadcrumb?: React.ReactNode;
  onUploadClick?: () => void;
  onCollectEvidenceClick?: () => void;
  mobileMenuFooter?: React.ReactNode;
}

export function TopBar({
  breadcrumb,
  onUploadClick,
  onCollectEvidenceClick,
  mobileMenuFooter,
}: TopBarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.disabled),
    []
  );

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-container bg-surface-container-low px-4 lg:px-6">
        <div className="flex items-center gap-3 sm:gap-6">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/25 bg-surface-container-lowest text-on-surface shadow-sm md:hidden"
            aria-label="Open navigation menu"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <Link
            href="/"
            className="font-headline text-base font-bold tracking-[0.18em] text-on-surface md:hidden"
          >
            SF
          </Link>

          {breadcrumb && (
            <div className="hidden items-center gap-2 text-xs font-medium text-on-surface-variant md:flex">
              {breadcrumb}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="mx-1 hidden h-8 w-px bg-surface-container sm:block" />
          <div className="flex items-center gap-3 pl-1">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-bold text-on-surface">Operator</p>
              <p className="text-[11px] text-on-surface-variant">
                Infrastructure
              </p>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-container bg-surface-container-highest text-xs font-semibold text-on-surface-variant shadow-sm">
              Op
            </div>
          </div>
        </div>
      </header>

      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-on-surface/35 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          role="presentation"
        >
          <div
            className="absolute inset-x-3 top-3 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-4 py-4">
              <div>
                <div className="font-headline text-base font-bold text-on-surface">SignalForge</div>
                <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                  Mobile navigation and operator actions
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
                aria-label="Close navigation menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-5 px-4 py-4">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-on-surface-variant">Navigate</div>
                <div className="grid gap-2">
                  {mobileNavItems.map((item) => {
                    const isActive =
                      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition-colors ${
                          isActive
                            ? "border-primary/25 bg-primary/[0.07] text-on-surface"
                            : "border-outline-variant/15 bg-surface-container-low text-on-surface-variant"
                        }`}
                      >
                        <svg className="h-4.5 w-4.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d={item.icon} />
                        </svg>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-on-surface-variant">Actions</div>
                <div className="grid gap-2">
                  {onUploadClick ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onUploadClick();
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-primary to-primary-dim px-4 py-3 text-sm font-semibold text-on-primary shadow-sm"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Upload artifact
                    </button>
                  ) : null}
                  {onCollectEvidenceClick ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onCollectEvidenceClick();
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-3 text-sm font-medium text-on-surface"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              </div>

              {mobileMenuFooter ? (
                <div className="space-y-2 border-t border-outline-variant/15 pt-4">
                  <div className="text-[11px] font-semibold text-on-surface-variant">Session</div>
                  {mobileMenuFooter}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
