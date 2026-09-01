"use client";

import * as React from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const LONG_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface CalendarMonthParts {
  readonly year: number;
  readonly month: number;
}

interface DatePickerProps extends Omit<React.ComponentPropsWithoutRef<"button">, "children" | "onChange" | "value"> {
  readonly value?: string;
  readonly min?: string;
  readonly max?: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function parseDate(value: string | undefined): CalendarDateParts | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInMonth(date.year, date.month)
    ? date
    : undefined;
}

function todayParts(): CalendarDateParts {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

function dateKey(date: CalendarDateParts): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function monthFromDate(date: CalendarDateParts): CalendarMonthParts {
  return { year: date.year, month: date.month };
}

function addMonths(month: CalendarMonthParts, amount: number): CalendarMonthParts {
  const zeroBasedMonth = month.year * 12 + month.month - 1 + amount;
  const year = Math.floor(zeroBasedMonth / 12);
  return { year, month: zeroBasedMonth - year * 12 + 1 };
}

function addDays(date: CalendarDateParts, amount: number): CalendarDateParts {
  let next = { ...date };
  const direction = amount < 0 ? -1 : 1;

  for (let index = 0; index < Math.abs(amount); index += 1) {
    if (direction > 0) {
      if (next.day === daysInMonth(next.year, next.month)) {
        next = next.month === 12
          ? { year: next.year + 1, month: 1, day: 1 }
          : { year: next.year, month: next.month + 1, day: 1 };
      } else {
        next = { ...next, day: next.day + 1 };
      }
    } else if (next.day === 1) {
      const previousMonth = next.month === 1
        ? { year: next.year - 1, month: 12 }
        : { year: next.year, month: next.month - 1 };
      next = { ...previousMonth, day: daysInMonth(previousMonth.year, previousMonth.month) };
    } else {
      next = { ...next, day: next.day - 1 };
    }
  }

  return next;
}

// Zeller's congruence keeps calendar navigation date-only. It is used only to
// place weekdays and never serializes a Date object into the expense domain.
function weekdayIndex(date: CalendarDateParts): number {
  const month = date.month < 3 ? date.month + 12 : date.month;
  const year = date.month < 3 ? date.year - 1 : date.year;
  const saturdayBased = (
    date.day
    + Math.floor((13 * (month + 1)) / 5)
    + year
    + Math.floor(year / 4)
    - Math.floor(year / 100)
    + Math.floor(year / 400)
  ) % 7;
  return (saturdayBased + 6) % 7;
}

function formatDisplayDate(date: CalendarDateParts | undefined): string {
  if (!date) return "Select a date";
  return `${date.day} ${SHORT_MONTH_NAMES[date.month - 1]} ${date.year}`;
}

function formatAccessibleDate(date: CalendarDateParts): string {
  return `${date.day} ${LONG_MONTH_NAMES[date.month - 1]} ${date.year}`;
}

function calendarCells(month: CalendarMonthParts): readonly CalendarDateParts[] {
  const firstDay = { ...month, day: 1 };
  const firstCell = addDays(firstDay, -weekdayIndex(firstDay));
  return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
}

function sameDate(left: CalendarDateParts | undefined, right: CalendarDateParts): boolean {
  return left?.year === right.year && left.month === right.month && left.day === right.day;
}

function clampDate(
  date: CalendarDateParts,
  minimum: CalendarDateParts | undefined,
  maximum: CalendarDateParts | undefined,
): CalendarDateParts {
  const key = dateKey(date);
  if (minimum && key < dateKey(minimum)) return minimum;
  if (maximum && key > dateKey(maximum)) return maximum;
  return date;
}

function monthKey(month: CalendarMonthParts): number {
  return month.year * 12 + month.month - 1;
}

const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(function DatePicker(
  { className, value, min, max, onChange, invalid = false, disabled, id, ...props },
  ref,
) {
  const selectedDate = parseDate(value);
  const minimumDate = parseDate(min);
  const maximumDate = parseDate(max);
  const initialDate = clampDate(selectedDate ?? todayParts(), minimumDate, maximumDate);
  const [open, setOpen] = React.useState(false);
  const [popoverSide, setPopoverSide] = React.useState<"bottom" | "top">("bottom");
  const [viewMonth, setViewMonth] = React.useState<CalendarMonthParts>(monthFromDate(initialDate));
  const [focusDate, setFocusDate] = React.useState<CalendarDateParts>(initialDate);
  const dayRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const monthHeadingId = React.useId();
  const today = todayParts();
  const cells = calendarCells(viewMonth);
  const displayValue = formatDisplayDate(selectedDate);
  const selectedKey = selectedDate ? dateKey(selectedDate) : undefined;
  const focusKey = dateKey(focusDate);
  const previousMonthUnavailable = Boolean(
    minimumDate && monthKey(addMonths(viewMonth, -1)) < monthKey(monthFromDate(minimumDate)),
  );
  const nextMonthUnavailable = Boolean(
    maximumDate && monthKey(addMonths(viewMonth, 1)) > monthKey(monthFromDate(maximumDate)),
  );

  React.useEffect(() => {
    const nextSelectedDate = parseDate(value);
    if (!nextSelectedDate) return;
    const next = clampDate(nextSelectedDate, parseDate(min), parseDate(max));
    setViewMonth(monthFromDate(next));
    setFocusDate(next);
  }, [value, min, max]);

  function focusCalendarDate(nextDate: CalendarDateParts) {
    setFocusDate(nextDate);
    if (nextDate.month !== viewMonth.month || nextDate.year !== viewMonth.year) {
      setViewMonth(monthFromDate(nextDate));
    }
    const nextButton = dayRefs.current[dateKey(nextDate)];
    if (nextButton) {
      nextButton.focus();
    } else {
      window.requestAnimationFrame(() => dayRefs.current[dateKey(nextDate)]?.focus());
    }
  }

  function selectDate(nextDate: CalendarDateParts) {
    if (minimumDate && dateKey(nextDate) < dateKey(minimumDate)) return;
    if (maximumDate && dateKey(nextDate) > dateKey(maximumDate)) return;
    onChange(dateKey(nextDate));
    setViewMonth(monthFromDate(nextDate));
    setFocusDate(nextDate);
    setOpen(false);
  }

  function handleDayKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: CalendarDateParts) {
    let nextDate: CalendarDateParts | undefined;
    switch (event.key) {
      case "ArrowLeft":
        nextDate = addDays(date, -1);
        break;
      case "ArrowRight":
        nextDate = addDays(date, 1);
        break;
      case "ArrowUp":
        nextDate = addDays(date, -7);
        break;
      case "ArrowDown":
        nextDate = addDays(date, 7);
        break;
      case "Home":
        nextDate = addDays(date, -weekdayIndex(date));
        break;
      case "End":
        nextDate = addDays(date, 6 - weekdayIndex(date));
        break;
      case "PageUp":
      case "PageDown": {
        const nextMonth = addMonths(monthFromDate(date), event.key === "PageUp" ? -1 : 1);
        nextDate = {
          ...nextMonth,
          day: Math.min(date.day, daysInMonth(nextMonth.year, nextMonth.month)),
        };
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        selectDate(date);
        return;
      default:
        return;
    }

    event.preventDefault();
    if (nextDate) focusCalendarDate(clampDate(nextDate, minimumDate, maximumDate));
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setPopoverSide(window.innerWidth < 1024 ? "top" : "bottom");
      const anchor = clampDate(parseDate(value) ?? todayParts(), minimumDate, maximumDate);
      setViewMonth(monthFromDate(anchor));
      setFocusDate(anchor);
    }
  }

  return (
    <PopoverPrimitive.Root onOpenChange={handleOpenChange} open={open}>
      <PopoverPrimitive.Trigger asChild>
        <button
          {...props}
          className={cn(
            "group/date-picker flex h-11 w-full min-w-0 items-center gap-2 rounded-[12px] border border-input bg-card px-3 text-left text-sm text-foreground shadow-[var(--shadow-small)] transition-[background-color,border-color,box-shadow,color] outline-none hover:bg-secondary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-secondary disabled:text-text-disabled disabled:opacity-80 data-[invalid]:border-destructive data-[invalid]:ring-3 data-[invalid]:ring-destructive/20",
            className,
          )}
          data-invalid={invalid ? "true" : undefined}
          data-slot="date-picker-trigger"
          disabled={disabled}
          id={id}
          ref={ref}
          type="button"
        >
          <Calendar aria-hidden="true" className="size-4 shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 truncate">{displayValue}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted transition-transform duration-150 group-data-[state=open]/date-picker:rotate-180" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          aria-labelledby={monthHeadingId}
          className="z-50 w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[var(--shadow-card)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => dayRefs.current[focusKey]?.focus());
          }}
          side={popoverSide}
          sideOffset={6}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              aria-label="Previous month"
              className="inline-flex size-9 items-center justify-center rounded-lg text-text-secondary outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={() => {
                const nextMonth = addMonths(viewMonth, -1);
                setViewMonth(nextMonth);
                setFocusDate({ ...nextMonth, day: 1 });
              }}
              disabled={previousMonthUnavailable}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <h2 className="text-sm font-semibold" id={monthHeadingId}>
              {LONG_MONTH_NAMES[viewMonth.month - 1]} {viewMonth.year}
            </h2>
            <button
              aria-label="Next month"
              className="inline-flex size-9 items-center justify-center rounded-lg text-text-secondary outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={() => {
                const nextMonth = addMonths(viewMonth, 1);
                setViewMonth(nextMonth);
                setFocusDate({ ...nextMonth, day: 1 });
              }}
              disabled={nextMonthUnavailable}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>

          <p aria-live="polite" className="sr-only">
            {selectedDate ? `Selected date: ${formatAccessibleDate(selectedDate)}` : "No date selected"}
          </p>

          <table aria-label={`${LONG_MONTH_NAMES[viewMonth.month - 1]} ${viewMonth.year}`} className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                {WEEKDAY_NAMES.map((weekday) => (
                  <th className="h-8 text-center text-mini font-medium uppercase tracking-wide text-text-muted" key={weekday} scope="col">
                    {weekday}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <tr key={`week-${weekIndex}`}>
                  {cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                    const key = dateKey(date);
                    const selected = key === selectedKey;
                    const todayDate = sameDate(today, date);
                    const inCurrentMonth = date.month === viewMonth.month && date.year === viewMonth.year;
                    const beforeMinimum = Boolean(minimumDate && key < dateKey(minimumDate));
                    const afterMaximum = Boolean(maximumDate && key > dateKey(maximumDate));
                    const unavailable = beforeMinimum || afterMaximum;
                    return (
                      <td className="p-0.5 text-center" key={key}>
                        <button
                          aria-current={todayDate ? "date" : undefined}
                          aria-label={`${formatAccessibleDate(date)}${selected ? ", selected" : ""}${todayDate ? ", today" : ""}`}
                          aria-pressed={selected}
                          className={cn(
                            "inline-flex size-10 items-center justify-center rounded-lg text-xs outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30",
                            !inCurrentMonth && "text-text-muted/50",
                            todayDate && !selected && "border border-brand bg-brand-soft text-foreground",
                            selected && "bg-primary font-semibold text-primary-foreground hover:bg-brand-hover",
                            unavailable && "cursor-not-allowed text-text-disabled hover:bg-transparent",
                          )}
                          disabled={unavailable}
                          onClick={() => selectDate(date)}
                          onKeyDown={(event) => handleDayKeyDown(event, date)}
                          ref={(element) => {
                            dayRefs.current[key] = element;
                          }}
                          tabIndex={!unavailable && focusKey === key ? 0 : -1}
                          type="button"
                        >
                          {date.day}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});

DatePicker.displayName = "DatePicker";

export { DatePicker };
