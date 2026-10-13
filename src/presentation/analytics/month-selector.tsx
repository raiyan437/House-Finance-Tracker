import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  compareCalendarMonths,
  formatCalendarMonth,
  nextCalendarMonth,
  previousCalendarMonth,
  type CalendarMonth,
} from "@/application/analytics/calendar-month";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MonthSelectorProps {
  readonly options: readonly CalendarMonth[];
  readonly value: CalendarMonth;
  readonly onChange: (month: CalendarMonth) => void;
  readonly ariaLabel?: string;
  readonly includeIntermediateMonths?: boolean;
}

export function MonthSelector({
  options,
  value,
  onChange,
  ariaLabel = "Select month",
  includeIntermediateMonths = false,
}: MonthSelectorProps) {
  const suppliedOptions = options.includes(value) ? options : [value, ...options];
  const oldestOption = suppliedOptions.reduce(
    (oldest, option) => (compareCalendarMonths(option, oldest) < 0 ? option : oldest),
    suppliedOptions[0],
  );
  const newestOption = suppliedOptions.reduce(
    (newest, option) => (compareCalendarMonths(option, newest) > 0 ? option : newest),
    suppliedOptions[0],
  );
  const availableOptions = includeIntermediateMonths ? [] : [...suppliedOptions];
  if (includeIntermediateMonths) {
    // The chevrons already allow every calendar month inside these bounds.
    for (let option = newestOption; ; option = previousCalendarMonth(option)) {
      availableOptions.push(option);
      if (option === oldestOption) break;
    }
  }
  const canStepPrevious = compareCalendarMonths(previousCalendarMonth(value), oldestOption) >= 0;
  const canStepNext = compareCalendarMonths(nextCalendarMonth(value), newestOption) <= 0;

  return (
    <div className="flex items-center gap-1" data-slot="month-selector">
      <Button
        aria-disabled={!canStepPrevious}
        aria-label="Previous month"
        className="size-11 rounded-md"
        onClick={() => canStepPrevious && onChange(previousCalendarMonth(value))}
        size="icon-sm"
        tabIndex={canStepPrevious ? 0 : -1}
        variant="ghost"
      >
        <ChevronLeft />
      </Button>
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
      <Button
        aria-disabled={!canStepNext}
        aria-label="Next month"
        className="size-11 rounded-md"
        onClick={() => canStepNext && onChange(nextCalendarMonth(value))}
        size="icon-sm"
        tabIndex={canStepNext ? 0 : -1}
        variant="ghost"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
