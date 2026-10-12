import { Prisma, RoundPhase } from "@prisma/client";
import { CardCells, PatternDefinition, RoomSettings, evaluateAllWinners, generateDrawSequence, generateUniqueCards, getPattern, leaders, resolveTiebreak } from "@bingo/shared";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function transactionWithRetry<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError("CONCURRENCY_ERROR", "No se pudo serializar la operación", 409);
}

async function createRound(tx: Prisma.TransactionClient, roomId: string, tournamentId: string | null, ordinal: number, phase: RoundPhase, playerIds: string[], settings: RoomSettings, patternOverride?: { kind?: RoomSettings["patternKind"]; custom?: number[] }) {
  const kind = patternOverride?.kind ?? settings.patternKind;
  const pattern = getPattern(kind, patternOverride?.custom ?? settings.customPattern);
  const round = await tx.round.create({
    data: { roomId, tournamentId, ordinal, phase, pattern: json(pattern), drawMode: settings.drawMode, status: "IN_PROGRESS", drawSequence: json(generateDrawSequence()), startedAt: new Date() },
  });
  const cards = generateUniqueCards(playerIds.length * settings.cardsPerPlayer);
  let cursor = 0;
  await tx.card.createMany({ data: playerIds.flatMap((playerId) => Array.from({ length: settings.cardsPerPlayer }, (_, cardIndex) => ({ roundId: round.id, playerId, cardIndex, cells: json(cards[cursor++]!) }))) });
  return round;
}

export async function startGame(roomId: string) {
  return transactionWithRetry(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (!room || room.status !== "LOBBY") throw new AppError("INVALID_STATE", "La partida no puede iniciarse ahora", 409);
    const connected = room.players.filter((p) => p.connected);
    if (connected.length < 2) throw new AppError("NOT_ENOUGH_PLAYERS", "Se necesitan al menos dos jugadores conectados", 409);
    const settings = room.settings as unknown as RoomSettings;
    const tournament = settings.mode === "TOURNAMENT" ? await tx.tournament.create({
      data: { roomId, regularRoundCount: settings.regularRoundCount, status: "IN_PROGRESS", results: { create: room.players.map((p) => ({ playerId: p.id })) } },
    }) : null;
    const round = await createRound(tx, roomId, tournament?.id ?? null, 1, settings.mode === "TOURNAMENT" ? "REGULAR" : "SINGLE", room.players.map((p) => p.id), settings);
    await tx.room.update({ where: { id: roomId }, data: { status: "IN_PROGRESS", sequence: { increment: 1 } } });
    return round;
  });
}

export async function drawBall(roomId: string) {
  return transactionWithRetry(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room || room.status !== "IN_PROGRESS") throw new AppError("INVALID_STATE", "No hay una ronda activa", 409);
    const round = await tx.round.findFirst({ where: { roomId, status: "IN_PROGRESS" }, orderBy: { ordinal: "desc" }, include: { draws: { orderBy: { drawOrder: "asc" } }, cards: true } });
    if (!round) throw new AppError("ROUND_NOT_FOUND", "No se encontró la ronda activa", 404);
    const sequence = round.drawSequence as number[];
    const number = sequence[round.draws.length];
    if (number === undefined) {
      await tx.round.update({ where: { id: round.id }, data: { status: "FINISHED", endedAt: new Date() } });
      await tx.room.update({ where: { id: roomId }, data: { status: "ROUND_RESULT", sequence: { increment: 1 } } });
      return { roundId: round.id, number: null, drawOrder: round.draws.length, winnerIds: [], ended: true };
    }
    const drawOrder = round.draws.length + 1;
    await tx.draw.create({ data: { roundId: round.id, number, drawOrder } });
    const drawn = new Set([...round.draws.map((draw) => draw.number), number]);
    const winnerIds = evaluateAllWinners(round.cards.map((card) => ({ playerId: card.playerId, cells: card.cells as unknown as CardCells })), drawn, round.pattern as unknown as PatternDefinition);
    const ended = winnerIds.length > 0 || drawOrder === 75;
    if (ended) {
      if (winnerIds.length) await tx.roundWinner.createMany({ data: winnerIds.map((playerId) => ({ roundId: round.id, playerId })), skipDuplicates: true });
      await tx.round.update({ where: { id: round.id }, data: { status: "FINISHED", endedAt: new Date() } });
      if (round.phase === "REGULAR" && round.tournamentId && winnerIds.length) {
        await Promise.all(winnerIds.map((playerId) => tx.tournamentResult.update({ where: { tournamentId_playerId: { tournamentId: round.tournamentId!, playerId } }, data: { regularWins: { increment: 1 } } })));
      }
      await tx.room.update({ where: { id: roomId }, data: { status: "ROUND_RESULT", sequence: { increment: 1 } } });
    } else {
      await tx.room.update({ where: { id: roomId }, data: { sequence: { increment: 1 } } });
    }
    return { roundId: round.id, number, drawOrder, winnerIds, ended };
  });
}

export async function prepareNextRound(roomId: string, patternOverride?: { kind?: RoomSettings["patternKind"]; custom?: number[] }) {
  return transactionWithRetry(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, include: { players: true, tournaments: { orderBy: { createdAt: "desc" }, take: 1, include: { results: true } }, rounds: { orderBy: { ordinal: "desc" }, take: 1, include: { winners: true } } } });
    if (!room || room.status !== "ROUND_RESULT" || !room.rounds[0]) throw new AppError("INVALID_STATE", "No se puede avanzar de ronda", 409);
    const settings = room.settings as unknown as RoomSettings;
    const previous = room.rounds[0];
    if (previous.phase === "SINGLE") {
      await tx.room.update({ where: { id: roomId }, data: { status: "FINISHED", sequence: { increment: 1 } } });
      return { finished: true, championId: previous.winners[0]?.playerId ?? null };
    }
    const tournament = room.tournaments[0];
    if (!tournament) throw new AppError("TOURNAMENT_NOT_FOUND", "Torneo no encontrado", 404);
    let finalistIds: string[];
    let phase: RoundPhase;
    const regularRounds = await tx.round.count({ where: { tournamentId: tournament.id, phase: "REGULAR", status: "FINISHED" } });
    if (previous.phase === "REGULAR" && regularRounds < tournament.regularRoundCount) {
      finalistIds = room.players.map((p) => p.id);
      phase = "REGULAR";
    } else if (previous.phase === "REGULAR") {
      const totals = new Map(tournament.results.map((r) => [r.playerId, r.regularWins]));
      finalistIds = leaders(totals);
      if (finalistIds.length === 1) {
        const championId = finalistIds[0]!;
        await tx.tournament.update({ where: { id: tournament.id }, data: { status: "FINISHED", championPlayerId: championId, finishedAt: new Date() } });
        await tx.room.update({ where: { id: roomId }, data: { status: "FINISHED", sequence: { increment: 1 } } });
        return { finished: true, championId };
      }
      phase = "TIEBREAK";
      await tx.tournament.update({ where: { id: tournament.id }, data: { status: "TIEBREAK", finalistIds: json(finalistIds) } });
    } else {
      const previousFinalists = (tournament.finalistIds as string[] | null) ?? [];
      const decision = resolveTiebreak(previousFinalists, previous.winners.map((w) => w.playerId));
      if (decision.type === "CHAMPION") {
        await tx.tournament.update({ where: { id: tournament.id }, data: { status: "FINISHED", championPlayerId: decision.championId, finishedAt: new Date() } });
        await tx.room.update({ where: { id: roomId }, data: { status: "FINISHED", sequence: { increment: 1 } } });
        return { finished: true, championId: decision.championId };
      }
      finalistIds = decision.finalistIds;
      phase = "TIEBREAK";
      await tx.tournament.update({ where: { id: tournament.id }, data: { finalistIds: json(finalistIds) } });
    }
    const disconnectedFinalist = room.players.some((p) => finalistIds.includes(p.id) && !p.connected);
    if (phase === "TIEBREAK" && disconnectedFinalist) {
      await tx.tournament.update({ where: { id: tournament.id }, data: { status: "PAUSED", finalistIds: json(finalistIds) } });
      await tx.room.update({ where: { id: roomId }, data: { status: "PAUSED", sequence: { increment: 1 } } });
      return { paused: true, finalistIds };
    }
    const round = await createRound(tx, roomId, tournament.id, previous.ordinal + 1, phase, finalistIds, settings, patternOverride);
    await tx.room.update({ where: { id: roomId }, data: { status: "IN_PROGRESS", sequence: { increment: 1 } } });
    return { finished: false, round, finalistIds, tiebreak: phase === "TIEBREAK" };
  });
}

export async function toggleMark(roomId: string, playerId: string, cardId: string, cellIndex: number) {
  return transactionWithRetry(async (tx) => {
    const card = await tx.card.findFirst({ where: { id: cardId, playerId, round: { roomId, status: "IN_PROGRESS" } }, include: { round: { include: { draws: true } } } });
    if (!card) throw new AppError("CARD_NOT_FOUND", "Cartilla no encontrada", 404);
    const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
    if ((room.settings as unknown as RoomSettings).markMode !== "MANUAL") throw new AppError("AUTOMATIC_MARKING", "El marcado es automático", 409);
    const cells = card.cells as unknown as CardCells;
    const value = cells[cellIndex];
    if (value !== "FREE" && !card.round.draws.some((draw) => draw.number === value)) throw new AppError("NUMBER_NOT_DRAWN", "Ese número aún no ha salido", 409);
    const marks = new Set(card.marks as number[]);
    marks.has(cellIndex) ? marks.delete(cellIndex) : marks.add(cellIndex);
    await tx.card.update({ where: { id: card.id }, data: { marks: json([...marks]) } });
    return [...marks];
  });
}

export async function setPaused(roomId: string, pause: boolean) {
  return transactionWithRetry(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room || (pause ? room.status !== "IN_PROGRESS" : room.status !== "PAUSED")) throw new AppError("INVALID_STATE", "La sala no puede cambiar a ese estado", 409);
    const round = await tx.round.findFirst({ where: { roomId, status: pause ? "IN_PROGRESS" : "PAUSED" }, orderBy: { ordinal: "desc" } });
    if (!round) throw new AppError("ROUND_NOT_FOUND", "Ronda no encontrada", 404);
    await tx.round.update({ where: { id: round.id }, data: { status: pause ? "PAUSED" : "IN_PROGRESS" } });
    return tx.room.update({ where: { id: roomId }, data: { status: pause ? "PAUSED" : "IN_PROGRESS", sequence: { increment: 1 } } });
  });
}

export async function resumePendingTiebreak(roomId: string) {
  return transactionWithRetry(async (tx) => {
    const room = await tx.room.findUnique({
      where: { id: roomId },
      include: {
        players: true,
        tournaments: { orderBy: { createdAt: "desc" }, take: 1 },
        rounds: { orderBy: { ordinal: "desc" }, take: 1 },
      },
    });
    const tournament = room?.tournaments[0];
    const previous = room?.rounds[0];
    if (!room || room.status !== "PAUSED" || !tournament || tournament.status !== "PAUSED" || !previous || previous.status !== "FINISHED") {
      throw new AppError("INVALID_STATE", "No hay un desempate pendiente para reanudar", 409);
    }
    const finalistIds = (tournament.finalistIds as string[] | null) ?? [];
    if (finalistIds.length < 2) throw new AppError("INVALID_FINALISTS", "No hay suficientes finalistas", 409);
    if (room.players.some((player) => finalistIds.includes(player.id) && !player.connected)) {
      throw new AppError("FINALISTS_DISCONNECTED", "Todos los finalistas deben reconectarse", 409);
    }
    const settings = room.settings as unknown as RoomSettings;
    const round = await createRound(tx, room.id, tournament.id, previous.ordinal + 1, "TIEBREAK", finalistIds, settings);
    await tx.tournament.update({ where: { id: tournament.id }, data: { status: "TIEBREAK" } });
    await tx.room.update({ where: { id: room.id }, data: { status: "IN_PROGRESS", sequence: { increment: 1 } } });
    return round;
  });
}
