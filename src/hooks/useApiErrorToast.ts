import { useCallback, useContext } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeApiError } from "@/lib/userFacingError";

/**
 * Returns a stable function that shows a plain-language error toast for an API
 * error, with a deep-link action (e.g. "Open Python settings") when one applies.
 *
 * The router navigator is read from context rather than `useNavigate`: it keeps
 * the callback identity stable across location changes, and the hook stays
 * usable (without the action) outside a router.
 *
 * @param title Optional short headline; the mapped message becomes the description.
 */
export function useApiErrorToast() {
  const { t } = useTranslation();
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;

  return useCallback(
    (error: unknown, title?: string) => {
      const { message, action } = describeApiError(error, t);
      toast.error(title ?? message, {
        ...(title ? { description: message } : {}),
        ...(action && navigator ? { action: { label: action.label, onClick: () => navigator.push(action.href) } } : {}),
      });
    },
    [t, navigator],
  );
}
