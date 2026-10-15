/** A card's points as pips: ●●○ for a 2. */
export function Pips({ n }: { n: number }) {
  return (
    <span className="pips" title={`${n} point${n === 1 ? "" : "s"}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * Face-down cards, fanned, with their total: what the table sees of an
 * offer. Which card is worth what stays hidden, so only the total is shown.
 */
export function CardFan({ count, points }: { count: number; points: number }) {
  if (!count) return <span className="muted small">nothing</span>;
  const spread = Math.min(8, 24 / count);
  return (
    <span className="fan" title={`${points} point${points === 1 ? "" : "s"} on ${count} card${count === 1 ? "" : "s"}`}>
      <span className="backs">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="cardback" style={{ transform: `rotate(${(i - (count - 1) / 2) * spread}deg)` }} />
        ))}
      </span>
      <span className="total">
        {points}
        <small>pt{points === 1 ? "" : "s"}</small>
      </span>
    </span>
  );
}
