"use client";

import type { NoiseItem } from "@/lib/analyzer/schema";

interface SuppressedNoisePanelProps {
  items: NoiseItem[];
}

export function SuppressedNoisePanel({ items }: SuppressedNoisePanelProps) {
  if (items.length === 0) return null;

  return (
    <details className="rounded-lg border border-surface-container bg-surface-container-lowest overflow-hidden shadow-sm group">
      <summary className="flex items-center justify-between p-4 cursor-pointer list-none hover:bg-surface-container-low/30 select-none">
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 text-outline-variant"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
          <span className="text-xs font-bold uppercase text-on-surface-variant">
            Suppressed Noise ({items.length})
          </span>
        </div>
        <svg
          className="h-5 w-5 text-outline-variant group-open:rotate-180 transition-transform"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </summary>
      <div className="p-4 border-t border-surface-container-low space-y-2">
        <p className="text-[11px] text-outline-variant mb-2">
          These observations are classified as expected given the environment
          context. Excluded from findings to reduce alert fatigue.
        </p>
        {items.map((item, i) => (
          <div
            key={i}
            className="flex justify-between text-[11px] text-on-surface-variant py-1.5 border-b border-surface-container-low last:border-0"
          >
            <span>{item.observation}</span>
            <span className="italic text-outline-variant shrink-0 ml-4">
              {item.related_environment}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
