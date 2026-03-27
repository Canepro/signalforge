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
    <div className="sf-panel relative overflow-hidden px-4 py-3.5">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${accentColor}`} />
      <p className="sf-kicker">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <h3 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
          {value}
        </h3>
        {subtitle && (
          <p className="text-xs font-medium text-on-surface-variant">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
