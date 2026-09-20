import {
  BRACKETS,
  BRACKET_IDS,
  type BracketId,
  type BracketReport,
  type BracketSelfReport,
} from "@mtg-commander/shared";

interface Props {
  selfReport: BracketSelfReport;
  report: BracketReport | null;
  gameChangerCount: number;
  saving: boolean;
  onChange: (next: BracketSelfReport) => void;
  onSave: () => void;
}

const ATTESTATIONS: Array<{ key: keyof BracketSelfReport; label: string; hint: string }> = [
  {
    key: "hasMassLandDenial",
    label: "Mass land denial",
    hint: "Armageddon effects, or repeatedly keeping opponents off lands.",
  },
  {
    key: "hasChainedExtraTurns",
    label: "Chained extra turns",
    hint: "Taking extra turns back-to-back, rather than a one-off extra turn.",
  },
  {
    key: "hasTwoCardCombos",
    label: "Two-card infinite combos",
    hint: "Two cards that together win the game or loop infinitely.",
  },
  {
    key: "hasHeavyTutoring",
    label: "Heavy tutoring",
    hint: "Multiple tutors that reliably find the same card every game.",
  },
];

export default function BracketPanel({ selfReport, report, gameChangerCount, saving, onChange, onSave }: Props) {
  const rules = BRACKETS[selfReport.bracket];

  function set<K extends keyof BracketSelfReport>(key: K, value: BracketSelfReport[K]) {
    onChange({ ...selfReport, [key]: value });
  }

  const errors = report?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = report?.issues.filter((i) => i.severity === "warning") ?? [];
  // Brackets 1 and 2 share the same hard rules, so a "floor" below what you
  // claimed says nothing useful — only surface it when it's above.
  const showFloor = report && report.suggestedMinimumBracket > selfReport.bracket;

  return (
    <section style={{ border: "1px solid #2a2d36", borderRadius: "8px", padding: "0.75rem", marginBottom: "1rem" }}>
      <h2 style={{ marginTop: 0 }}>Bracket</h2>

      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        {BRACKET_IDS.map((id) => (
          <button
            key={id}
            onClick={() => set("bracket", id as BracketId)}
            style={{
              padding: "0.4rem 0.6rem",
              background: id === selfReport.bracket ? "#8ab4f8" : "#1d2029",
              color: id === selfReport.bracket ? "#12141a" : "#e8e8ec",
              border: "1px solid #2a2d36",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {id}. {BRACKETS[id].name}
          </button>
        ))}
      </div>

      <p style={{ opacity: 0.8, fontSize: "0.85rem", margin: "0 0 0.5rem" }}>{rules.tagline}</p>

      <ul style={{ fontSize: "0.85rem", opacity: 0.85, margin: "0 0 0.75rem", paddingLeft: "1.1rem" }}>
        <li>
          Game Changers: {rules.maxGameChangers === null ? "no limit" : `up to ${rules.maxGameChangers}`} — this deck has{" "}
          <strong>{gameChangerCount}</strong>
        </li>
        <li>Mass land denial: {rules.allowsMassLandDenial ? "allowed" : "not allowed"}</li>
        <li>Chained extra turns: {rules.allowsChainedExtraTurns ? "allowed" : "not allowed"}</li>
        <li>
          Two-card combos:{" "}
          {rules.twoCardCombos === "any" ? "allowed" : rules.twoCardCombos === "late-game" ? "late game only" : "not allowed"}
        </li>
      </ul>

      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.85rem", marginBottom: "0.35rem", opacity: 0.8 }}>
          Card data can't detect these — tell us what's in the deck:
        </div>
        {ATTESTATIONS.map(({ key, label, hint }) => (
          <label key={key} style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.2rem" }}>
            <input type="checkbox" checked={selfReport[key] === true} onChange={(e) => set(key, e.target.checked)} /> {label}{" "}
            <span style={{ opacity: 0.55 }}>— {hint}</span>
          </label>
        ))}
        {selfReport.hasTwoCardCombos && (
          <label style={{ display: "block", fontSize: "0.85rem", marginLeft: "1.2rem" }}>
            <input
              type="checkbox"
              checked={selfReport.combosAreLateGameOnly}
              onChange={(e) => set("combosAreLateGameOnly", e.target.checked)}
            />{" "}
            ...and they only come together late in the game
          </label>
        )}
      </div>

      <button onClick={onSave} disabled={saving}>
        {saving ? "Saving..." : "Save bracket"}
      </button>

      {report && (
        <div style={{ marginTop: "0.6rem" }}>
          {errors.length === 0 ? (
            <div style={{ color: "#81c995" }}>This deck matches bracket {report.bracket}.</div>
          ) : (
            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.1rem" }}>
              {errors.map((issue, i) => (
                <li key={i} className="issue-error">
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {warnings.map((issue, i) => (
            <div key={i} className="issue-warning">
              {issue.message}
            </div>
          ))}
          {showFloor && (
            <div style={{ opacity: 0.8, fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Based on its contents, this deck belongs in bracket {report.suggestedMinimumBracket} or higher.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
