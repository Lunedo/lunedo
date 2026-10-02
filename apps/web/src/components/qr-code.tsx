import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function QrCode({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const segments: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) segments.push(`M${column + 2} ${row + 2}h1v1h-1z`);
      }
    }
    return { d: segments.join(""), size: count + 4 };
  }, [value]);
  return (
    <div
      data-theme="light"
      className="inline-flex shrink-0 rounded-md border border-border bg-surface p-1 text-text"
    >
      <svg role="img" aria-label={label} viewBox={`0 0 ${path.size} ${path.size}`} className="size-qr">
        <path d={path.d} fill="currentColor" />
      </svg>
    </div>
  );
}
