"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends React.ComponentProps<"div"> {
  readonly label: string;
  readonly htmlFor?: string;
  readonly description?: string;
  readonly error?: string;
  readonly required?: boolean;
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  required,
  children,
  className,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const child = Children.only(children);
  const childId = isValidElement<Record<string, unknown>>(child)
    ? child.props.id
    : undefined;
  const controlId = htmlFor ?? (typeof childId === "string" ? childId : generatedId);
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const control = isValidElement<Record<string, unknown>>(child)
    ? cloneElement(child, {
        id: controlId,
        "aria-describedby": [
          child.props["aria-describedby"],
          descriptionId,
          errorId,
        ]
          .filter(Boolean)
          .join(" ") || undefined,
        "aria-invalid": child.props["aria-invalid"] ?? Boolean(error),
        required: child.props.required ?? required,
      })
    : child;

  return (
    <div className={cn("grid gap-2", className)} data-slot="form-field" {...props}>
      <Label htmlFor={controlId}>
        {label}
        {required ? <span className="text-danger" aria-hidden="true">*</span> : null}
      </Label>
      {control}
      {description ? (
        <p className="text-caption text-text-secondary" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="text-caption text-danger" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
