import { ThemeToggle } from "./theme-toggle";

interface TopBarProps {
  breadcrumb?: React.ReactNode;
}

export function TopBar({ breadcrumb }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-surface-container bg-surface-container-low px-4 lg:px-6">
      <div className="flex items-center gap-6">
        {/* Mobile logo */}
        <span className="font-headline text-lg font-bold uppercase tracking-widest text-on-surface md:hidden">
          SF
        </span>

        {breadcrumb && (
          <div className="hidden items-center gap-2 text-xs font-medium text-on-surface-variant md:flex">
            {breadcrumb}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="h-8 w-px bg-surface-container mx-1 hidden sm:block" />
        <div className="flex items-center gap-3 pl-1">
          <div className="hidden text-right sm:block">
            <p className="text-xs font-bold text-on-surface">Operator</p>
            <p className="text-[10px] uppercase tracking-tight text-on-surface-variant">
              Infrastructure
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-surface-container bg-surface-container-highest text-xs font-semibold text-on-surface-variant shadow-sm">
            Op
          </div>
        </div>
      </div>
    </header>
  );
}
