import { Prisma } from "@prisma/client";
import { CreateRoomInput, joinRoomSchema, roomCodeSchema } from "@bingo/shared";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { generateRoomCode, hashGuestToken, issueGuestToken } from "./security.js";

export async function createRoom(input: CreateRoomInput) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const token = issueGuestToken();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const room = await tx.room.create({ data: { code, settings: input.settings as unknown as Prisma.InputJsonValue } });
        const player = await tx.player.create({ data: { roomId: room.id, nickname: input.nickname, reconnectTokenHash: hashGuestToken(token) } });
        await tx.room.update({ where: { id: room.id }, data: { hostPlayerId: player.id } });
        return { room, player };
      });
      return { code, token, playerId: result.player.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new AppError("CODE_GENERATION_FAILED", "No se pudo generar el código", 500);
}

export async function joinRoom(rawCode: string, body: unknown) {
  const code = roomCodeSchema.parse(rawCode);
  const { nickname } = joinRoomSchema.parse(body);
  const token = issueGuestToken();
  const room = await prisma.room.findUnique({ where: { code }, include: { _count: { select: { players: true } } } });
  if (!room) throw new AppError("ROOM_NOT_FOUND", "La sala no existe", 404);
  const settings = room.settings as { maxPlayers: number };
  if (room.status !== "LOBBY") throw new AppError("ROOM_STARTED", "La sala ya comenzó", 409);
  if (room._count.players >= settings.maxPlayers) throw new AppError("ROOM_FULL", "La sala está llena", 409);
  try {
    const player = await prisma.player.create({ data: { roomId: room.id, nickname, reconnectTokenHash: hashGuestToken(token) } });
    return { code, token, playerId: player.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("NICKNAME_TAKEN", "Ese apodo ya está en uso", 409);
    }
    throw error;
  }
}

export async function authenticate(code: string, token: string) {
  const player = await prisma.player.findFirst({
    where: { reconnectTokenHash: hashGuestToken(token), room: { code } },
    include: { room: true },
  });
  if (!player) throw new AppError("UNAUTHORIZED", "Token de reconexión inválido", 401);
  return player;
}
