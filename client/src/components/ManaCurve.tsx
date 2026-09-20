import type { Card } from "@mtg-commander/shared";

interface Props {
  cards: Array<{ card: Card; quantity: number }>;
}

export default function ManaCurve({ cards }: Props) {
  const buckets = new Array(8).fill(0); // 0,1,2,3,4,5,6,7+
  for (const { card, quantity } of cards) {
    if (card.typeLine.includes("Land")) continue;
    const bucket = Math.min(Math.floor(card.cmc), 7);
    buckets[bucket] += quantity;
  }
  const max = Math.max(1, ...buckets);

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "flex-end", height: "120px" }}>
      {buckets.map((count, cmc) => (
        <div key={cmc} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: `${(count / max) * 100}px`, width: "24px", background: "#8ab4f8" }} title={`${count} cards`} />
          <div>{cmc === 7 ? "7+" : cmc}</div>
        </div>
      ))}
    </div>
  );
}
