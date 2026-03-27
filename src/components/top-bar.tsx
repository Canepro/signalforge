"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "./theme-toggle";
import { NAV_ITEMS } from "./sidebar";

interface TopBarProps {
  breadcrumb?: React.ReactNode;
  onUploadClick?: () => void;
  onCollectEvidenceClick?: () => void;
  mobileMenuFooter?: React.ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function TopBar({
  breadcrumb,
  onUploadClick,
  onCollectEvidenceClick,
  mobileMenuFooter,
}: TopBarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.disabled),
    []
  );

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = Array.from(
      mobileDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
    ).filter((element) => !element.hasAttribute("disabled"));

    (focusables[0] ?? mobileDialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const activeFocusables = Array.from(
        mobileDialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      ).filter((element) => !element.hasAttribute("disabled"));

      if (activeFocusables.length === 0) {
        event.preventDefault();
        mobileDialogRef.current?.focus();
        return;
      }

      const first = activeFocusables[0]!;
      const last = activeFocusables[activeFocusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || active === mobileDialogRef.current) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileMenuOpen]);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant/10 bg-surface-container-low px-4 lg:px-6">
        <div className="flex items-center gap-3 sm:gap-6">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="sf-btn-icon md:hidden"
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-dialog"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <Link
            href="/"
            className="font-headline text-sm font-bold uppercase tracking-[0.22em] text-on-surface md:hidden"
          >
            SignalForge
          </Link>

          {breadcrumb && (
            <div className="hidden items-center gap-2 text-sm font-medium text-on-surface-variant md:flex">
              {breadcrumb}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="mx-1 hidden h-8 w-px bg-outline-variant/15 sm:block" />
          <div className="flex items-center gap-3 pl-1">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-on-surface">Operator</p>
              <p className="text-xs text-on-surface-variant">
                Infrastructure
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-highest text-xs font-semibold text-on-surface-variant shadow-sm">
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
            id="mobile-navigation-dialog"
            ref={mobileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
            tabIndex={-1}
            className="absolute inset-x-3 top-3 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-xl outline-none"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/15 px-4 py-4">
              <div>
                <div id="mobile-navigation-title" className="font-headline text-lg font-bold text-on-surface">
                  SignalForge
                </div>
                <div className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  Navigation and operator actions
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="sf-btn-icon h-10 w-10"
                aria-label="Close navigation menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-5 px-4 py-4">
              <div className="space-y-2">
                <div className="sf-kicker">Navigate</div>
                <div className="grid gap-2">
                  {mobileNavItems.map((item) => {
                    const isActive =
                      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`sf-shell-link rounded-xl border px-3 py-3 ${
                          isActive
                            ? "border-primary/25 bg-primary/[0.07] text-on-surface shadow-sm"
                            : "border-outline-variant/15 bg-surface-container-low text-on-surface-variant hover:border-outline-variant/25 hover:bg-surface-container"
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
                <div className="sf-kicker">Actions</div>
                <div className="grid gap-2">
                  {onUploadClick ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onUploadClick();
                      }}
                      className="sf-btn-primary w-full rounded-xl"
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
                      className="sf-btn-secondary w-full rounded-xl"
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
                  <div className="sf-kicker">Session</div>
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
