import type { CardCells, PatternDefinition, RoomSettings, RoomSnapshot } from "@bingo/shared";
import { coveredIndices } from "@bingo/shared";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";

export async function buildSnapshot(roomId: string, selfPlayerId: string): Promise<RoomSnapshot> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      players: { orderBy: { joinedAt: "asc" } },
      rounds: {
        orderBy: { ordinal: "desc" },
        take: 1,
        include: {
          draws: { orderBy: { drawOrder: "asc" } },
          cards: { where: { playerId: selfPlayerId }, orderBy: { cardIndex: "asc" } },
          winners: true,
        },
      },
      tournaments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { results: { include: { player: true } } },
      },
    },
  });
  if (!room) throw new AppError("ROOM_NOT_FOUND", "La sala no existe", 404);

  const latestRound = room.rounds[0] ?? null;
  const tournament = room.tournaments[0] ?? null;
  const drawnBalls = latestRound?.draws.map((draw) => draw.number) ?? [];
  const drawnSet = new Set(drawnBalls);
  const finalistIds = new Set((tournament?.finalistIds as string[] | null) ?? []);

  return {
    code: room.code,
    status: room.status,
    sequence: room.sequence,
    settings: room.settings as unknown as RoomSettings,
    players: room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      connected: player.connected,
      isHost: player.id === room.hostPlayerId,
    })),
    selfPlayerId,
    round: latestRound
      ? {
          id: latestRound.id,
          ordinal: latestRound.ordinal,
          phase: latestRound.phase,
          pattern: latestRound.pattern as unknown as PatternDefinition,
          currentBall: drawnBalls.at(-1) ?? null,
          drawnBalls,
          remainingCount: 75 - drawnBalls.length,
          cards: latestRound.cards.map((card) => {
            const cells = card.cells as unknown as CardCells;
            const automaticMarks = [...coveredIndices(cells, drawnSet)];
            return {
              id: card.id,
              cardIndex: card.cardIndex,
              cells,
              marked: room.settings && (room.settings as unknown as RoomSettings).markMode === "AUTOMATIC"
                ? automaticMarks
                : (card.marks as number[]),
            };
          }),
          winnerIds: latestRound.winners.map((winner) => winner.playerId),
        }
      : null,
    standings: tournament
      ? tournament.results
          .map((result) => ({
            playerId: result.playerId,
            nickname: result.player.nickname,
            regularWins: result.regularWins,
            finalist: finalistIds.has(result.playerId),
          }))
          .sort((a, b) => b.regularWins - a.regularWins || a.nickname.localeCompare(b.nickname))
      : [],
    championPlayerId: tournament?.championPlayerId ??
      (room.status === "FINISHED" && latestRound?.phase === "SINGLE" ? latestRound.winners[0]?.playerId ?? null : null),
  };
}

export async function publicRoom(code: string) {
  const room = await prisma.room.findUnique({
    where: { code },
    include: { players: { select: { id: true, nickname: true, connected: true } } },
  });
  if (!room) throw new AppError("ROOM_NOT_FOUND", "La sala no existe", 404);
  const settings = room.settings as unknown as RoomSettings;
  return {
    code: room.code,
    status: room.status,
    playerCount: room.players.length,
    maxPlayers: settings.maxPlayers,
    players: room.players.map((player) => ({ ...player, isHost: player.id === room.hostPlayerId })),
  };
}
