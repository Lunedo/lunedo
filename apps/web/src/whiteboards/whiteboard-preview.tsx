import { Presentation } from "lucide-react";
import { useState } from "react";
import { previewUrl } from "./whiteboard-api.js";

export function WhiteboardPreview({
  itemId,
  version,
  label,
  className = "",
}: {
  itemId: string;
  version?: number;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={label}
        className={`flex items-center justify-center rounded-sm border border-border bg-surface-sunken text-text-muted ${className}`}
      >
        <Presentation aria-hidden="true" className="size-icon-lg" />
      </span>
    );
  }
  return (
    <img
      src={previewUrl(itemId, version)}
      alt={label}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`rounded-sm border border-border bg-surface object-contain ${className}`}
    />
  );
}
