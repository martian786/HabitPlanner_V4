import React from "react";
import SwatchPicker from "./SwatchPicker";
import { useChromiumDesktopSwatch } from "../hooks/useChromiumDesktopSwatch";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  stopPropagation?: boolean; // for objective rows that have row click handlers
  showCustom?: boolean;      // if you want "Custom…" inside the swatch popover
};

export default function ColorField({
  value,
  onChange,
  className = "h-6 w-6 p-0 border rounded",
  stopPropagation = false,
  showCustom = false,
}: Props) {
  const useSwatch = useChromiumDesktopSwatch();

  const Wrapper: React.FC<React.PropsWithChildren> = ({ children }) =>
    stopPropagation ? <span onClick={(e) => e.stopPropagation()}>{children}</span> : <>{children}</>;

  // Extract size from className for SwatchPicker
  const sizeMatch = className.match(/h-(\d+)/);
  const size = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 24; // Convert Tailwind to pixels (h-6 = 24px)

  return (
    <Wrapper>
      {useSwatch ? (
        <SwatchPicker
          value={value}
          onChange={onChange}
          showCustom={showCustom}
          size={size}
          className={className}
        />
      ) : (
        <input
          type="color"
          title="Pick colour"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={className}
        />
      )}
    </Wrapper>
  );
}