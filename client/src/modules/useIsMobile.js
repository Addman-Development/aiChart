import { useMedia } from "react-use";

// Single source of truth for the JS-side "is this a phone?" check.
// Mirrors the Tailwind mobile-first convention used across the app:
// unprefixed classes target phones (< 640px) and `sm:` and up restore the
// desktop layout. Used by the app shell drawer, the dashboard/public stack
// renderers and the editor route guard.
export default function useIsMobile() {
  return useMedia("(max-width: 639px)", false);
}
