import { CalendarDays, ChevronDown } from "lucide-react";
import { tryCalendarMonth, type CalendarMonth } from "@/application/analytics/calendar-month";

interface MonthSelectorProps {
  readonly value: CalendarMonth;
  readonly onChange: (month: CalendarMonth) => void;
  readonly ariaLabel?: string;
}

export function MonthSelector({
  value,
  onChange,
  ariaLabel = "Select month",
}: MonthSelectorProps) {
  return (
    <label className="relative inline-flex h-11 w-[190px] items-center rounded-[14px] border bg-card shadow-[var(--shadow-small)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
      <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 z-10 size-4 text-text-secondary" />
      <input
        aria-label={ariaLabel}
        className="absolute -inset-px h-11 w-[190px] cursor-pointer rounded-[14px] border-0 bg-transparent pl-10 pr-8 text-left text-[13px] font-semibold outline-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        max="9999-12"
        min="0001-01"
        type="month"
        value={value}
        onClick={(event) => event.currentTarget.showPicker?.()}
        onChange={(event) => {
          const month = tryCalendarMonth(event.target.value);
          if (month) onChange(month);
        }}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 z-10 size-4 text-text-muted" />
    </label>
  );
}
