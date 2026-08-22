import { CalendarDays } from "lucide-react";
import { formatCalendarMonth, type CalendarMonth } from "@/application/analytics/calendar-month";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MonthSelectorProps {
  readonly options: readonly CalendarMonth[];
  readonly value: CalendarMonth;
  readonly onChange: (month: CalendarMonth) => void;
  readonly ariaLabel?: string;
}

export function MonthSelector({
  options,
  value,
  onChange,
  ariaLabel = "Select month",
}: MonthSelectorProps) {
  const availableOptions = options.includes(value) ? options : [value, ...options];

  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as CalendarMonth)}>
      <SelectTrigger aria-label={ariaLabel} className="w-[190px] rounded-md font-semibold" size="compact">
        <CalendarDays aria-hidden="true" className="size-4 text-text-secondary" />
        <SelectValue aria-label={formatCalendarMonth(value)} />
      </SelectTrigger>
      <SelectContent align="start">
        {availableOptions.map((option) => (
          <SelectItem key={option} value={option}>
            {formatCalendarMonth(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
