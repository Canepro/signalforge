interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accentColor?: string;
}

export function KpiCard({
  label,
  value,
  subtitle,
  accentColor = "bg-primary",
}: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-container-lowest p-4 shadow-sm">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor}`} />
      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <h3 className="font-headline text-3xl font-bold text-on-surface">
          {value}
        </h3>
        {subtitle && (
          <p className="text-[10px] font-medium text-on-surface-variant">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
