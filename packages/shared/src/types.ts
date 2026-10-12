export const COLUMN_RANGES = [
  [1, 15], [16, 30], [31, 45], [46, 60], [61, 75],
] as const;

export type Cell = number | "FREE";
export type CardCells = Cell[];
export type PatternKind = "HORIZONTAL" | "VERTICAL" | "DIAGONAL" | "L" | "U" | "X" | "T" | "CORNERS" | "FULL" | "CUSTOM";
export type RoundPhase = "REGULAR" | "TIEBREAK" | "SINGLE";
export type DrawMode = "MANUAL" | "AUTOMATIC";
export type MarkMode = "MANUAL" | "AUTOMATIC";
export type RoomStatus = "LOBBY" | "IN_PROGRESS" | "ROUND_RESULT" | "PAUSED" | "FINISHED" | "CANCELLED";

export interface PatternDefinition {
  kind: PatternKind;
  variants: number[][];
  label: string;
}

export interface RoomSettings {
  maxPlayers: number;
  cardsPerPlayer: number;
  mode: "SINGLE" | "TOURNAMENT";
  regularRoundCount: number;
  drawMode: DrawMode;
  drawIntervalSeconds: 3 | 5 | 10;
  markMode: MarkMode;
  patternKind: PatternKind;
  customPattern?: number[];
  patternPerRound: boolean;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  isHost: boolean;
}

export interface ClientCard {
  id: string;
  cardIndex: number;
  cells: CardCells;
  marked: number[];
}

export interface Standing {
  playerId: string;
  nickname: string;
  regularWins: number;
  finalist: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  sequence: number;
  settings: RoomSettings;
  players: PublicPlayer[];
  selfPlayerId: string;
  round: null | {
    id: string;
    ordinal: number;
    phase: RoundPhase;
    pattern: PatternDefinition;
    currentBall: number | null;
    drawnBalls: number[];
    remainingCount: number;
    cards: ClientCard[];
    winnerIds: string[];
  };
  standings: Standing[];
  championPlayerId: string | null;
}
