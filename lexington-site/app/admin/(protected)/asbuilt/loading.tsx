import styles from "@/components/crm/Crm.module.css";

export default function AsBuiltLoading() {
  return (
    <main className={styles.crmPage} aria-busy="true" aria-label="Loading the as-built record">
      <div className={styles.skeleton}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
    </main>
  );
}
