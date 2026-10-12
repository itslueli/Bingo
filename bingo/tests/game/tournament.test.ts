import { describe, expect, it } from "vitest";
import { leaders, regularWinTotals, resolveTiebreak } from "../../packages/shared/src/index.js";

describe("torneos", () => {
  it("suma una victoria completa a cada ganador compartido", () => {
    const totals = regularWinTotals(["a", "b", "c"], [{ winnerIds: ["a", "b"] }, { winnerIds: ["a"] }, { winnerIds: ["b", "b"] }, { winnerIds: [] }]);
    expect(Object.fromEntries(totals)).toEqual({ a: 2, b: 2, c: 0 });
    expect(leaders(totals)).toEqual(["a", "b"]);
  });
  it("declara campeón solo con un ganador de desempate", () => {
    expect(resolveTiebreak(["a", "b"], ["a"])).toEqual({ type: "CHAMPION", championId: "a" });
  });
  it("repite entre ganadores compartidos o conserva finalistas sin ganador", () => {
    expect(resolveTiebreak(["a", "b", "c"], ["a", "c"])).toEqual({ type: "REPEAT", finalistIds: ["a", "c"] });
    expect(resolveTiebreak(["a", "b"], [])).toEqual({ type: "REPEAT", finalistIds: ["a", "b"] });
  });
});
