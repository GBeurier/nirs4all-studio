import { useCallback } from "react";

export interface SelectWheelOption<T> {
  value: T;
}

export function useSelectWheel<T extends string | number | boolean>(
  value: T,
  onChange: (value: T) => void,
  options: SelectWheelOption<T>[],
  enabled: boolean = true
) {
  return useCallback(
    (e: React.WheelEvent) => {
      if (!enabled || options.length === 0) return;

      // Prevent scrolling the parent container
      e.stopPropagation();

      const stringValue = String(value);
      const currentIndex = options.findIndex((opt) => String(opt.value) === stringValue);

      if (currentIndex === -1) return;

      // Determine direction: deltaY > 0 means scrolling down -> next option
      const direction = e.deltaY > 0 ? 1 : -1;
      let nextIndex = currentIndex + direction;

      // Clamp to bounds
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= options.length) nextIndex = options.length - 1;

      if (nextIndex !== currentIndex) {
        onChange(options[nextIndex].value);
      }
    },
    [value, onChange, options, enabled]
  );
}
