"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HouseCodeControls({ code }: Readonly<{ code: string }>) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("House Code copied.");
    } catch {
      setStatus("House Code could not be copied.");
    }
  }

  return (
    <div className="mt-5 rounded-xl border bg-secondary/45 p-4">
      <p className="text-label text-text-secondary">House Code</p>
      <p
        aria-label={visible ? `House Code ${code}` : "House Code hidden"}
        className="mt-2 min-h-8 font-mono text-xl font-semibold tracking-[0.16em] tabular-nums"
      >
        {visible ? code : "•••••••••"}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          aria-label={visible ? "Hide House Code" : "Show House Code"}
          className="min-h-11"
          onClick={() => {
            setVisible((current) => !current);
            setStatus(visible ? "House Code hidden." : "House Code shown.");
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {visible ? "Hide" : "Show"}
        </Button>
        <Button
          aria-label="Copy exact House Code"
          className="min-h-11"
          onClick={() => void copyCode()}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy aria-hidden="true" /> Copy
        </Button>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        {status}
      </p>
    </div>
  );
}
