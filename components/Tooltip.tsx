import React from "react";

type TooltipProps = {
  text: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
};

export default function Tooltip({ text, children, side = "top" }: TooltipProps) {
  const pos =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : "top-full mt-2 left-1/2 -translate-x-1/2";

  const arrow =
    side === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-l-transparent border-r-transparent border-b-transparent"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-l-transparent border-r-transparent border-t-transparent";

  return (
    <span className="relative inline-flex group outline-none">
      {children}

      {/* Tooltip bubble */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${pos} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150`}
      >
        <span className="relative inline-block max-w-[260px] whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg">
          {text}
          <span
            className={`pointer-events-none absolute ${arrow} border-[6px]`}
          />
        </span>
      </span>
    </span>
  );
}
