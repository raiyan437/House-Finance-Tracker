"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, "id" | "type"> {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
  readonly containerClassName?: string;
}

function PasswordField({
  id,
  label,
  error,
  containerClassName,
  className,
  "aria-describedby": describedBy,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = React.useState(false);
  const errorId = `${id}-error`;
  const descriptionIds = [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-2", containerClassName)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...inputProps}
          id={id}
          type={visible ? "text" : "password"}
          className={cn("pr-12", className)}
          aria-invalid={Boolean(error) || inputProps["aria-invalid"]}
          aria-describedby={descriptionIds}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute inset-y-0 right-0 rounded-l-none text-text-muted hover:text-foreground"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      {error ? <p id={errorId} className="text-caption text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

export { PasswordField };
