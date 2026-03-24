import type { EnvironmentContext } from "@/lib/analyzer/schema";

interface EnvironmentBannerProps {
  env: EnvironmentContext;
}

export function EnvironmentBanner({ env }: EnvironmentBannerProps) {
  const tags: string[] = [];
  if (env.is_wsl) tags.push("WSL");
  if (env.is_container) tags.push("Container");
  if (env.is_virtual_machine) tags.push("VM");
  if (env.ran_as_root) tags.push("Root");

  return (
    <div className="rounded-lg border border-surface-container bg-surface-container-lowest p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase text-on-surface-variant mb-3">
        Environment Context
      </h3>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] font-bold text-outline-variant uppercase tracking-widest">
            Target Host
          </div>
          <div className="text-sm font-bold text-on-surface">
            {env.hostname}
            <span className="text-xs font-normal text-on-surface-variant ml-2">
              {env.os}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 text-[10px]">
          <div className="text-outline-variant">Kernel</div>
          <div className="text-on-surface-variant font-mono text-right truncate">
            {env.kernel}
          </div>
          {env.uptime && (
            <>
              <div className="text-outline-variant">Uptime</div>
              <div className="text-on-surface-variant font-mono text-right">
                {env.uptime}
              </div>
            </>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
