import styles from "./ProximityGrid.module.css";

const PLACES = [
  { place: "Lycée Français", time: "4 min" },
  { place: "Legon City Mall", time: "5 min" },
  { place: "Accra Mall", time: "6 min" },
  { place: "Kotoka Int'l Airport", time: "7 min" },
  { place: "Al Rayan School", time: "8 min" },
  { place: "Galaxy International School", time: "9 min" },
  { place: "A&C Mall", time: "9 min" },
  { place: "37 Military Hospital", time: "10 min" },
  { place: "Lincoln Community School", time: "11 min" },
];

export function ProximityGrid() {
  return (
    <div className={styles.grid}>
      {PLACES.map((p) => (
        <div className={styles.item} key={p.place}>
          <span className={styles.place}>{p.place}</span>
          <span className={styles.time}>{p.time}</span>
        </div>
      ))}
    </div>
  );
}
