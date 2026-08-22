"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--success-background)",
          "--success-border": "var(--success-foreground)",
          "--success-text": "var(--success-foreground)",
          "--info-bg": "var(--info-background)",
          "--info-border": "var(--info-foreground)",
          "--info-text": "var(--foreground)",
          "--warning-bg": "var(--warning-background)",
          "--warning-border": "var(--warning-foreground)",
          "--warning-text": "var(--warning-foreground)",
          "--error-bg": "var(--danger-background)",
          "--error-border": "var(--danger-foreground)",
          "--error-text": "var(--danger-foreground)",
          "--border-radius": "var(--radius-medium)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
