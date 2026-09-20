import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  DEFAULT_BRACKET_SELF_REPORT,
  type BracketReport,
  type BracketSelfReport,
  type Card,
  type DeckLegalityReport,
} from "@mtg-commander/shared";
import { api } from "../api/client";
import BracketPanel from "../components/BracketPanel";
import CardSearch from "../components/CardSearch";
import ManaCurve from "../components/ManaCurve";

interface Entry {
  card: Card;
  quantity: number;
  isCommander: boolean;
}

export default function DeckBuilder() {
  const { deckId } = useParams<{ deckId: string }>();
  const [deckName, setDeckName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [legality, setLegality] = useState<DeckLegalityReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [selfReport, setSelfReport] = useState<BracketSelfReport>(DEFAULT_BRACKET_SELF_REPORT);
  const [bracketReport, setBracketReport] = useState<BracketReport | null>(null);
  const [savingBracket, setSavingBracket] = useState(false);

  useEffect(() => {
    if (!deckId) return;
    api.getDeck(deckId).then(async (deck) => {
      setDeckName(deck.name);
      setLegality(deck.legality);
      setBracketReport(deck.bracketReport);
      setSelfReport({
        bracket: deck.bracket,
        hasMassLandDenial: deck.hasMassLandDenial,
        hasChainedExtraTurns: deck.hasChainedExtraTurns,
        hasTwoCardCombos: deck.hasTwoCardCombos,
        combosAreLateGameOnly: deck.combosAreLateGameOnly,
        hasHeavyTutoring: deck.hasHeavyTutoring,
      });
      const resolved = await Promise.all(
        deck.cards.map(async (dc) => ({
          card: await api.getCard(dc.cardOracleId),
          quantity: dc.quantity,
          isCommander: dc.isCommander,
        }))
      );
      setEntries(resolved);
    });
  }, [deckId]);

  function addCard(card: Card, asCommander: boolean) {
    setEntries((prev) => {
      const existing = prev.find((e) => e.card.oracleId === card.oracleId);
      if (existing) {
        if (card.typeLine.includes("Basic Land")) {
          return prev.map((e) => (e.card.oracleId === card.oracleId ? { ...e, quantity: e.quantity + 1 } : e));
        }
        return prev; // singleton, already present
      }
      return [...prev, { card, quantity: 1, isCommander: asCommander }];
    });
  }

  function removeOne(oracleId: string) {
    setEntries((prev) =>
      prev
        .map((e) => (e.card.oracleId === oracleId ? { ...e, quantity: e.quantity - 1 } : e))
        .filter((e) => e.quantity > 0)
    );
  }

  async function save() {
    if (!deckId) return;
    setSaving(true);
    try {
      const payload = entries.map((e) => ({ cardOracleId: e.card.oracleId, quantity: e.quantity, isCommander: e.isCommander }));
      const result = await api.saveDeckCards(deckId, payload);
      setLegality(result.legality);
      setBracketReport(result.bracketReport);
    } finally {
      setSaving(false);
    }
  }

  async function saveBracket() {
    if (!deckId) return;
    setSavingBracket(true);
    try {
      const result = await api.saveDeckBracket(deckId, selfReport);
      setBracketReport(result.bracketReport);
    } finally {
      setSavingBracket(false);
    }
  }

  const commanders = entries.filter((e) => e.isCommander);
  const deckSize = entries.reduce((sum, e) => sum + e.quantity, 0);

  return (
    <div className="page">
      <h1>{deckName || "Deck Builder"}</h1>
      <p>
        {deckSize} / 100 cards · Commander: {commanders.map((c) => c.card.name).join(" + ") || "none set"}
      </p>

      <ManaCurve cards={entries} />

      <button onClick={save} disabled={saving} style={{ margin: "0.75rem 0" }}>
        {saving ? "Saving..." : "Save deck"}
      </button>

      {legality && (
        <div style={{ marginBottom: "1rem" }}>
          <strong>{legality.legal ? "Legal" : "Not legal"}</strong>
          <ul>
            {legality.issues.map((issue, i) => (
              <li key={i} className={issue.severity === "error" ? "issue-error" : "issue-warning"}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <BracketPanel
        selfReport={selfReport}
        report={bracketReport}
        gameChangerCount={legality?.gameChangerCount ?? 0}
        saving={savingBracket}
        onChange={setSelfReport}
        onSave={saveBracket}
      />

      <h2>Add cards</h2>
      <CardSearch onAdd={addCard} />

      <h2>Deck list ({deckSize})</h2>
      <ul>
        {entries.map((e) => (
          <li key={e.card.oracleId}>
            {e.isCommander && "[Commander] "}
            {e.quantity > 1 ? `${e.quantity}x ` : ""}
            {e.card.name}
            <button onClick={() => removeOne(e.card.oracleId)} style={{ marginLeft: "0.5rem" }}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
