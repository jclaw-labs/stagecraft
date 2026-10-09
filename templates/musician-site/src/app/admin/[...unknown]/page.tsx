import { notFound } from "next/navigation";

/**
 * Any `/admin/*` URL no other admin route serves.
 *
 * Next sends an unmatched URL to `global-not-found.tsx`, which is the
 * artist-themed public 404. Catching it here and calling `notFound()`
 * renders `admin/not-found.tsx` instead. Real admin routes always win
 * over a catch-all, and middleware still signs the visitor in first.
 */
export default function AdminUnknownRoute(): never {
  notFound();
}
