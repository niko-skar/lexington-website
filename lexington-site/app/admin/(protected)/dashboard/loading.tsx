import styles from "@/components/crm/Crm.module.css";

export default function DashboardLoading() {
  return (
    <main className={styles.crmPage} aria-busy="true" aria-label="Loading the dashboard">
      <div className={styles.skeleton}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
    </main>
  );
}
