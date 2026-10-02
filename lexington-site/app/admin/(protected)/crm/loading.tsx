import styles from "@/components/crm/Crm.module.css";
import portal from "@/components/Portal.module.css";

// Shown the moment a prospect or tab is clicked, while the real page loads.
export default function Loading() {
  return (
    <main className={portal.page} aria-busy="true">
      <div className={styles.skeleton}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
    </main>
  );
}
