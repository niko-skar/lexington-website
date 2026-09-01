import styles from "./PromoBanner.module.css";

export function PromoBanner({ message }: { message: string }) {
  return (
    <div className={styles.banner} role="note" aria-label="Site announcement">
      <div className={styles.track}>
        <span className={styles.item}>{message}</span>
        <span className={styles.item} aria-hidden="true">
          {message}
        </span>
      </div>
    </div>
  );
}
