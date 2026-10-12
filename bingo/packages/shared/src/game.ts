import { CardCells, COLUMN_RANGES, PatternDefinition, PatternKind } from "./types.js";

export const FREE_INDEX = 12;

function secureRandomIndex(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("Límite aleatorio inválido");
  const range = 0x1_0000_0000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % maxExclusive;
}

function secureShuffle<T>(input: readonly T[]): T[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function generateDrawSequence(): number[] {
  return secureShuffle(Array.from({ length: 75 }, (_, i) => i + 1));
}

export function generateCard(): CardCells {
  const cells: CardCells = Array(25).fill("FREE");
  COLUMN_RANGES.forEach(([min, max], column) => {
    const values = secureShuffle(Array.from({ length: max - min + 1 }, (_, i) => min + i)).slice(0, column === 2 ? 4 : 5);
    let cursor = 0;
    for (let row = 0; row < 5; row++) {
      const index = row * 5 + column;
      if (index !== FREE_INDEX) cells[index] = values[cursor++]!;
    }
  });
  return cells;
}

export function generateUniqueCards(count: number): CardCells[] {
  const cards: CardCells[] = [];
  const fingerprints = new Set<string>();
  while (cards.length < count) {
    const card = generateCard();
    const key = card.join(",");
    if (!fingerprints.has(key)) {
      fingerprints.add(key);
      cards.push(card);
    }
  }
  return cards;
}

const rows = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => row * 5 + col));
const columns = Array.from({ length: 5 }, (_, col) => Array.from({ length: 5 }, (_, row) => row * 5 + col));

export function getPattern(kind: PatternKind, custom: number[] = []): PatternDefinition {
  const definitions: Record<Exclude<PatternKind, "CUSTOM">, PatternDefinition> = {
    HORIZONTAL: { kind, label: "Línea horizontal", variants: rows },
    VERTICAL: { kind, label: "Línea vertical", variants: columns },
    DIAGONAL: { kind, label: "Diagonal", variants: [[0, 6, 12, 18, 24], [4, 8, 12, 16, 20]] },
    L: { kind, label: "L (izquierda y base)", variants: [[0, 5, 10, 15, 20, 21, 22, 23, 24]] },
    U: { kind, label: "U (laterales y base)", variants: [[0, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]] },
    X: { kind, label: "X", variants: [[0, 4, 6, 8, 12, 16, 18, 20, 24]] },
    T: { kind, label: "T (fila superior y centro)", variants: [[0, 1, 2, 3, 4, 7, 12, 17, 22]] },
    CORNERS: { kind, label: "Cuatro esquinas", variants: [[0, 4, 20, 24]] },
    FULL: { kind, label: "Cartón lleno", variants: [Array.from({ length: 25 }, (_, i) => i)] },
  };
  if (kind === "CUSTOM") {
    const normalized = [...new Set(custom)].sort((a, b) => a - b);
    if (normalized.length === 0 || normalized.some((i) => i < 0 || i > 24)) throw new Error("Patrón personalizado inválido");
    return { kind, label: "Patrón personalizado", variants: [normalized] };
  }
  return definitions[kind];
}

export function coveredIndices(cells: CardCells, drawn: ReadonlySet<number>): Set<number> {
  const result = new Set<number>([FREE_INDEX]);
  cells.forEach((cell, index) => {
    if (cell !== "FREE" && drawn.has(cell)) result.add(index);
  });
  return result;
}

export function isWinningCard(cells: CardCells, drawn: ReadonlySet<number>, pattern: PatternDefinition): boolean {
  if (cells.length !== 25) return false;
  const covered = coveredIndices(cells, drawn);
  return pattern.variants.some((variant) => variant.every((index) => covered.has(index)));
}

export interface EvaluatedCard { playerId: string; cells: CardCells }

export function evaluateAllWinners(cards: readonly EvaluatedCard[], drawn: ReadonlySet<number>, pattern: PatternDefinition): string[] {
  return [...new Set(cards.filter((card) => isWinningCard(card.cells, drawn, pattern)).map((card) => card.playerId))];
}
