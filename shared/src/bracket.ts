/**
 * The Commander Brackets, as published by the Commander format panel.
 *
 * Brackets are a self-assessment and conversation tool, not a banlist: only
 * the Game Changer count is objectively checkable from card data, so the
 * other axes are attested by the deck's owner.
 */
export type BracketId = 1 | 2 | 3 | 4 | 5;

export const BRACKET_IDS: BracketId[] = [1, 2, 3, 4, 5];

export type ComboAllowance = "none" | "late-game" | "any";

export interface BracketRules {
  id: BracketId;
  name: string;
  tagline: string;
  /** null means no limit. */
  maxGameChangers: number | null;
  allowsMassLandDenial: boolean;
  allowsChainedExtraTurns: boolean;
  twoCardCombos: ComboAllowance;
  /** Brackets 1-2 ask for tutoring to stay sparse; this is guidance, not a hard limit. */
  expectsSparseTutoring: boolean;
}

export const BRACKETS: Record<BracketId, BracketRules> = {
  1: {
    id: 1,
    name: "Exhibition",
    tagline: "Built around a theme or experience. Winning is secondary and games go long.",
    maxGameChangers: 0,
    allowsMassLandDenial: false,
    allowsChainedExtraTurns: false,
    twoCardCombos: "none",
    expectsSparseTutoring: true,
  },
  2: {
    id: 2,
    name: "Core",
    tagline: "Roughly the power of a modern preconstructed deck. Games usually end around turn 9 or later.",
    maxGameChangers: 0,
    allowsMassLandDenial: false,
    allowsChainedExtraTurns: false,
    twoCardCombos: "none",
    expectsSparseTutoring: true,
  },
  3: {
    id: 3,
    name: "Upgraded",
    tagline: "Beyond precon power, with stronger cards and tighter curves. Games usually end around turn 6-9.",
    maxGameChangers: 3,
    allowsMassLandDenial: false,
    allowsChainedExtraTurns: false,
    twoCardCombos: "late-game",
    expectsSparseTutoring: false,
  },
  4: {
    id: 4,
    name: "Optimized",
    tagline: "High power with no restrictions beyond the banlist, but not built for a competitive metagame.",
    maxGameChangers: null,
    allowsMassLandDenial: true,
    allowsChainedExtraTurns: true,
    twoCardCombos: "any",
    expectsSparseTutoring: false,
  },
  5: {
    id: 5,
    name: "cEDH",
    tagline: "Competitive Commander: built to win against the strongest decks in a tournament metagame.",
    maxGameChangers: null,
    allowsMassLandDenial: true,
    allowsChainedExtraTurns: true,
    twoCardCombos: "any",
    expectsSparseTutoring: false,
  },
};

/** What a deck's owner tells us about the things card data can't reveal. */
export interface BracketSelfReport {
  bracket: BracketId;
  hasMassLandDenial: boolean;
  hasChainedExtraTurns: boolean;
  hasTwoCardCombos: boolean;
  /** Only meaningful when hasTwoCardCombos is true; bracket 3 allows late-game combos only. */
  combosAreLateGameOnly: boolean;
  hasHeavyTutoring: boolean;
}

export const DEFAULT_BRACKET_SELF_REPORT: BracketSelfReport = {
  bracket: 2,
  hasMassLandDenial: false,
  hasChainedExtraTurns: false,
  hasTwoCardCombos: false,
  combosAreLateGameOnly: false,
  hasHeavyTutoring: false,
};

export interface BracketIssue {
  severity: "error" | "warning";
  code:
    | "TOO_MANY_GAME_CHANGERS"
    | "MASS_LAND_DENIAL_NOT_ALLOWED"
    | "CHAINED_EXTRA_TURNS_NOT_ALLOWED"
    | "COMBOS_NOT_ALLOWED"
    | "COMBOS_MUST_BE_LATE_GAME"
    | "TUTORING_SHOULD_BE_SPARSE";
  message: string;
}

export interface BracketReport {
  bracket: BracketId;
  gameChangerCount: number;
  /** True when nothing in the deck contradicts the bracket it claims. */
  matchesDeck: boolean;
  /** The lowest bracket this deck could honestly be entered as. */
  suggestedMinimumBracket: BracketId;
  issues: BracketIssue[];
}

/**
 * Cross-checks a declared bracket against the deck's Game Changer count (from
 * Scryfall) and the owner's own answers. Anything that contradicts the claim is
 * an error; softer expectations (like sparse tutoring) are warnings.
 */
export function evaluateBracket(report: BracketSelfReport, gameChangerCount: number): BracketReport {
  const rules = BRACKETS[report.bracket];
  const issues: BracketIssue[] = [];

  if (rules.maxGameChangers !== null && gameChangerCount > rules.maxGameChangers) {
    issues.push({
      severity: "error",
      code: "TOO_MANY_GAME_CHANGERS",
      message:
        rules.maxGameChangers === 0
          ? `Bracket ${rules.id} (${rules.name}) allows no Game Changers, but this deck has ${gameChangerCount}.`
          : `Bracket ${rules.id} (${rules.name}) allows up to ${rules.maxGameChangers} Game Changers, but this deck has ${gameChangerCount}.`,
    });
  }

  if (report.hasMassLandDenial && !rules.allowsMassLandDenial) {
    issues.push({
      severity: "error",
      code: "MASS_LAND_DENIAL_NOT_ALLOWED",
      message: `Bracket ${rules.id} (${rules.name}) excludes mass land denial.`,
    });
  }

  if (report.hasChainedExtraTurns && !rules.allowsChainedExtraTurns) {
    issues.push({
      severity: "error",
      code: "CHAINED_EXTRA_TURNS_NOT_ALLOWED",
      message: `Bracket ${rules.id} (${rules.name}) excludes chaining extra turns.`,
    });
  }

  if (report.hasTwoCardCombos) {
    if (rules.twoCardCombos === "none") {
      issues.push({
        severity: "error",
        code: "COMBOS_NOT_ALLOWED",
        message: `Bracket ${rules.id} (${rules.name}) excludes two-card infinite combos.`,
      });
    } else if (rules.twoCardCombos === "late-game" && !report.combosAreLateGameOnly) {
      issues.push({
        severity: "error",
        code: "COMBOS_MUST_BE_LATE_GAME",
        message: `Bracket ${rules.id} (${rules.name}) only allows two-card combos that come together late in the game.`,
      });
    }
  }

  if (report.hasHeavyTutoring && rules.expectsSparseTutoring) {
    issues.push({
      severity: "warning",
      code: "TUTORING_SHOULD_BE_SPARSE",
      message: `Bracket ${rules.id} (${rules.name}) expects tutoring to stay sparse.`,
    });
  }

  return {
    bracket: report.bracket,
    gameChangerCount,
    matchesDeck: issues.every((issue) => issue.severity !== "error"),
    suggestedMinimumBracket: suggestMinimumBracket(report, gameChangerCount),
    issues,
  };
}

/** The lowest bracket whose hard rules this deck actually satisfies. */
export function suggestMinimumBracket(report: BracketSelfReport, gameChangerCount: number): BracketId {
  for (const id of BRACKET_IDS) {
    const rules = BRACKETS[id];
    if (rules.maxGameChangers !== null && gameChangerCount > rules.maxGameChangers) continue;
    if (report.hasMassLandDenial && !rules.allowsMassLandDenial) continue;
    if (report.hasChainedExtraTurns && !rules.allowsChainedExtraTurns) continue;
    if (report.hasTwoCardCombos) {
      if (rules.twoCardCombos === "none") continue;
      if (rules.twoCardCombos === "late-game" && !report.combosAreLateGameOnly) continue;
    }
    return id;
  }
  return 4;
}
