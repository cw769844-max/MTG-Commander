import { describe, expect, it } from "vitest";
import {
  BRACKETS,
  DEFAULT_BRACKET_SELF_REPORT,
  evaluateBracket,
  suggestMinimumBracket,
  type BracketId,
  type BracketSelfReport,
} from "./bracket";

const report = (overrides: Partial<BracketSelfReport> = {}): BracketSelfReport => ({
  ...DEFAULT_BRACKET_SELF_REPORT,
  ...overrides,
});

const codes = (r: BracketSelfReport, gameChangers: number) => evaluateBracket(r, gameChangers).issues.map((i) => i.code);

describe("Game Changer limits", () => {
  it.each([1, 2] as BracketId[])("allows no Game Changers at bracket %i", (bracket) => {
    expect(BRACKETS[bracket].maxGameChangers).toBe(0);
    expect(codes(report({ bracket }), 1)).toContain("TOO_MANY_GAME_CHANGERS");
    expect(evaluateBracket(report({ bracket }), 0).matchesDeck).toBe(true);
  });

  it("allows up to three at bracket 3", () => {
    expect(evaluateBracket(report({ bracket: 3 }), 3).matchesDeck).toBe(true);
    expect(codes(report({ bracket: 3 }), 4)).toContain("TOO_MANY_GAME_CHANGERS");
  });

  it.each([4, 5] as BracketId[])("has no limit at bracket %i", (bracket) => {
    expect(BRACKETS[bracket].maxGameChangers).toBeNull();
    expect(evaluateBracket(report({ bracket }), 20).matchesDeck).toBe(true);
  });
});

describe("self-reported contents", () => {
  it("rejects mass land denial below bracket 4", () => {
    for (const bracket of [1, 2, 3] as BracketId[]) {
      expect(codes(report({ bracket, hasMassLandDenial: true }), 0)).toContain("MASS_LAND_DENIAL_NOT_ALLOWED");
    }
    expect(evaluateBracket(report({ bracket: 4, hasMassLandDenial: true }), 0).matchesDeck).toBe(true);
  });

  it("rejects chained extra turns below bracket 4", () => {
    expect(codes(report({ bracket: 3, hasChainedExtraTurns: true }), 0)).toContain(
      "CHAINED_EXTRA_TURNS_NOT_ALLOWED"
    );
    expect(evaluateBracket(report({ bracket: 4, hasChainedExtraTurns: true }), 0).matchesDeck).toBe(true);
  });

  it("rejects two-card combos at brackets 1 and 2", () => {
    expect(codes(report({ bracket: 2, hasTwoCardCombos: true }), 0)).toContain("COMBOS_NOT_ALLOWED");
  });

  it("allows only late-game combos at bracket 3", () => {
    expect(codes(report({ bracket: 3, hasTwoCardCombos: true }), 0)).toContain("COMBOS_MUST_BE_LATE_GAME");
    expect(
      evaluateBracket(report({ bracket: 3, hasTwoCardCombos: true, combosAreLateGameOnly: true }), 0).matchesDeck
    ).toBe(true);
  });

  it("treats heavy tutoring as a warning, not a blocker", () => {
    const result = evaluateBracket(report({ bracket: 1, hasHeavyTutoring: true }), 0);
    expect(result.matchesDeck).toBe(true);
    expect(result.issues.some((i) => i.code === "TUTORING_SHOULD_BE_SPARSE" && i.severity === "warning")).toBe(true);
  });
});

describe("suggested minimum bracket", () => {
  it("suggests the lowest bracket a clean deck satisfies", () => {
    expect(suggestMinimumBracket(report(), 0)).toBe(1);
  });

  it("pushes a deck with Game Changers upward", () => {
    expect(suggestMinimumBracket(report(), 1)).toBe(3);
    expect(suggestMinimumBracket(report(), 4)).toBe(4);
  });

  it("pushes a deck with mass land denial to bracket 4", () => {
    expect(suggestMinimumBracket(report({ hasMassLandDenial: true }), 0)).toBe(4);
  });

  it("never suggests cEDH, which is about intent rather than contents", () => {
    const everything = report({
      hasMassLandDenial: true,
      hasChainedExtraTurns: true,
      hasTwoCardCombos: true,
      hasHeavyTutoring: true,
    });
    expect(suggestMinimumBracket(everything, 50)).toBe(4);
  });

  it("reports the floor alongside the declared bracket", () => {
    const result = evaluateBracket(report({ bracket: 2 }), 2);
    expect(result.bracket).toBe(2);
    expect(result.suggestedMinimumBracket).toBe(3);
    expect(result.matchesDeck).toBe(false);
    expect(result.gameChangerCount).toBe(2);
  });
});
