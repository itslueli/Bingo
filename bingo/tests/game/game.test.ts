import { describe, expect, it } from "vitest";
import { COLUMN_RANGES, evaluateAllWinners, generateCard, generateDrawSequence, generateUniqueCards, getPattern, isWinningCard } from "../../packages/shared/src/index.js";

describe("cartillas de 75 bolillas", () => {
  it("genera una cartilla válida con centro libre y rangos BINGO", () => {
    const card = generateCard();
    expect(card).toHaveLength(25);
    expect(card[12]).toBe("FREE");
    for (let column = 0; column < 5; column++) {
      const values = card.filter((_, index) => index % 5 === column && index !== 12) as number[];
      expect(new Set(values).size).toBe(values.length);
      expect(values.every((value) => value >= COLUMN_RANGES[column]![0] && value <= COLUMN_RANGES[column]![1])).toBe(true);
    }
  });

  it("no repite cartillas ni bolillas", () => {
    const cards = generateUniqueCards(20);
    expect(new Set(cards.map((card) => card.join(","))).size).toBe(20);
    const sequence = generateDrawSequence();
    expect(sequence).toHaveLength(75);
    expect(new Set(sequence).size).toBe(75);
    expect([...sequence].sort((a, b) => a - b)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
  });
});

describe("evaluación autoritativa", () => {
  const card = [1,16,31,46,61, 2,17,32,47,62, 3,18,"FREE",48,63, 4,19,33,49,64, 5,20,34,50,65] as const;

  it("considera el centro libre al completar una horizontal", () => {
    expect(isWinningCard([...card], new Set([3,18,48,63]), getPattern("HORIZONTAL"))).toBe(true);
  });
  it("no confunde números llamados con una línea incompleta", () => {
    expect(isWinningCard([...card], new Set([3,18,48]), getPattern("HORIZONTAL"))).toBe(false);
  });
  it("devuelve todos los jugadores simultáneos una sola vez", () => {
    const winners = evaluateAllWinners([{ playerId: "ana", cells: [...card] }, { playerId: "ana", cells: [...card] }, { playerId: "luis", cells: [...card] }], new Set([1,16,31,46,61]), getPattern("HORIZONTAL"));
    expect(winners).toEqual(["ana", "luis"]);
  });
  it("valida un patrón personalizado y elimina duplicados", () => {
    const pattern = getPattern("CUSTOM", [0, 0, 12, 24]);
    expect(pattern.variants[0]).toEqual([0, 12, 24]);
    expect(isWinningCard([...card], new Set([1,65]), pattern)).toBe(true);
    expect(() => getPattern("CUSTOM", [])).toThrow();
  });
});
