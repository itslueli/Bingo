export interface RegularResult { winnerIds: string[] }

export function regularWinTotals(playerIds: readonly string[], results: readonly RegularResult[]): Map<string, number> {
  const totals = new Map(playerIds.map((id) => [id, 0]));
  results.forEach(({ winnerIds }) => {
    new Set(winnerIds).forEach((id) => totals.set(id, (totals.get(id) ?? 0) + 1));
  });
  return totals;
}

export function leaders(totals: ReadonlyMap<string, number>): string[] {
  if (totals.size === 0) return [];
  const maximum = Math.max(...totals.values());
  return [...totals].filter(([, wins]) => wins === maximum).map(([id]) => id);
}

export type TiebreakDecision =
  | { type: "CHAMPION"; championId: string }
  | { type: "REPEAT"; finalistIds: string[] };

export function resolveTiebreak(previousFinalists: readonly string[], winnerIds: readonly string[]): TiebreakDecision {
  const eligibleWinners = [...new Set(winnerIds)].filter((id) => previousFinalists.includes(id));
  if (eligibleWinners.length === 1) return { type: "CHAMPION", championId: eligibleWinners[0]! };
  return { type: "REPEAT", finalistIds: eligibleWinners.length > 1 ? eligibleWinners : [...previousFinalists] };
}
