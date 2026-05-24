import styles from "./StatusBadge.module.css";

export type BadgeTone = "live" | "building" | "error" | "neutral";

const TONE_CLASS: Record<BadgeTone, string> = {
  live: styles.live,
  building: styles.building,
  error: styles.error,
  neutral: styles.neutral,
};

/**
 * Colour-coded status pill (dot + label) shared by the dashboard
 * SiteCard and the site-detail header. The `building` tone pulses its
 * dot so an in-progress site reads as active work, not a steady state.
 * Pure render — safe in both server and client components.
 */
export default function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}
