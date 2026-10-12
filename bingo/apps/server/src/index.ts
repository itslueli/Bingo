import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { Server } from "socket.io";
import {
  createRoomSchema,
  nextRoundSchema,
  roomCodeSchema,
  socketAuthSchema,
  toggleMarkSchema,
  type RoomSettings,
} from "@bingo/shared";
import { ZodError } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { AppError, publicError } from "./errors.js";
import { drawBall, prepareNextRound, resumePendingTiebreak, setPaused, startGame, toggleMark } from "./game-service.js";
import { authenticate, createRoom, joinRoom } from "./rooms.js";
import { buildSnapshot, publicRoom } from "./snapshot.js";

interface SocketData { playerId: string; roomId: string; code: string; isHost: boolean }

export const app = express();
app.use(helmet());
app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: false }));
app.use(express.json({ limit: "32kb" }));

const entryLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
app.get("/api/health", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post("/api/rooms", entryLimiter, async (req, res, next) => {
  try { res.status(201).json(await createRoom(createRoomSchema.parse(req.body))); } catch (error) { next(error); }
});
app.post("/api/rooms/:code/join", entryLimiter, async (req, res, next) => {
  try { res.status(201).json(await joinRoom(String(req.params.code ?? ""), req.body)); } catch (error) { next(error); }
});
app.get("/api/rooms/:code", async (req, res, next) => {
  try { res.json(await publicRoom(roomCodeSchema.parse(String(req.params.code ?? "")))); } catch (error) { next(error); }
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ code: "VALIDATION_ERROR", message: error.issues[0]?.message ?? "Datos inválidos", issues: error.issues });
  const body = publicError(error);
  return res.status(error instanceof AppError ? error.status : 500).json(body);
});

export const server = http.createServer(app);
export const io = new Server<Record<string, (...args: any[]) => void>, Record<string, (...args: any[]) => void>, Record<string, (...args: any[]) => void>, SocketData>(server, {
  cors: { origin: config.CLIENT_ORIGIN },
});

const automaticTimers = new Map<string, NodeJS.Timeout>();
const connectedSockets = new Map<string, Set<string>>();

function stopAutomatic(roomId: string) {
  const timer = automaticTimers.get(roomId);
  if (timer) clearInterval(timer);
  automaticTimers.delete(roomId);
}

async function emitSnapshots(roomId: string) {
  const sockets = await io.in(roomId).fetchSockets();
  await Promise.all(sockets.map(async (socket) => socket.emit("room:snapshot", await buildSnapshot(roomId, socket.data.playerId))));
}

async function drawAndPublish(roomId: string) {
  try {
    const result = await drawBall(roomId);
    io.to(roomId).emit("round:ballDrawn", result);
    if (result.ended) {
      stopAutomatic(roomId);
      io.to(roomId).emit("round:ended", result);
    }
    await emitSnapshots(roomId);
  } catch (error) {
    stopAutomatic(roomId);
    io.to(roomId).emit("error:action", publicError(error));
  }
}

async function startAutomaticIfNeeded(roomId: string) {
  stopAutomatic(roomId);
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.status !== "IN_PROGRESS") return;
  const settings = room.settings as unknown as RoomSettings;
  if (settings.drawMode !== "AUTOMATIC") return;
  automaticTimers.set(roomId, setInterval(() => void drawAndPublish(roomId), settings.drawIntervalSeconds * 1000));
}

io.use(async (socket, next) => {
  try {
    const auth = socketAuthSchema.parse(socket.handshake.auth);
    const player = await authenticate(auth.code, auth.token);
    socket.data = { playerId: player.id, roomId: player.roomId, code: auth.code, isHost: player.id === player.room.hostPlayerId };
    next();
  } catch (error) { next(new Error(publicError(error).message)); }
});

io.on("connection", async (socket) => {
  const { roomId, playerId } = socket.data;
  await socket.join(roomId);
  const playerSockets = connectedSockets.get(playerId) ?? new Set<string>();
  playerSockets.add(socket.id);
  connectedSockets.set(playerId, playerSockets);
  await prisma.player.update({ where: { id: playerId }, data: { connected: true, lastSeenAt: new Date() } });
  await emitSnapshots(roomId);
  io.to(roomId).emit("room:playersUpdated");

  const guarded = (hostOnly: boolean, action: () => Promise<void>) => async (ack?: (result: unknown) => void) => {
    try {
      if (hostOnly && !socket.data.isHost) throw new AppError("HOST_ONLY", "Solo el anfitrión puede realizar esta acción", 403);
      await action();
      ack?.({ ok: true });
    } catch (error) {
      const body = publicError(error);
      socket.emit("error:action", body);
      ack?.({ ok: false, error: body });
    }
  };

  socket.on("room:start", guarded(true, async () => {
    const round = await startGame(roomId);
    io.to(roomId).emit("round:started", { roundId: round.id });
    await emitSnapshots(roomId);
    await startAutomaticIfNeeded(roomId);
  }));
  socket.on("room:pause", guarded(true, async () => {
    await setPaused(roomId, true);
    stopAutomatic(roomId);
    io.to(roomId).emit("round:paused");
    await emitSnapshots(roomId);
  }));
  socket.on("room:resume", guarded(true, async () => {
    const activePausedRound = await prisma.round.findFirst({ where: { roomId, status: "PAUSED" } });
    if (activePausedRound) await setPaused(roomId, false);
    else await resumePendingTiebreak(roomId);
    await emitSnapshots(roomId);
    await startAutomaticIfNeeded(roomId);
  }));
  socket.on("round:draw", guarded(true, async () => {
    const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    if ((room.settings as unknown as RoomSettings).drawMode !== "MANUAL") throw new AppError("AUTOMATIC_DRAW", "El sorteo es automático", 409);
    await drawAndPublish(roomId);
  }));
  socket.on("round:next", async (payload: unknown, ack?: (result: unknown) => void) => {
    await guarded(true, async () => {
      const input = nextRoundSchema.parse(payload ?? {});
      const result = await prepareNextRound(roomId, { kind: input.patternKind, custom: input.customPattern });
      if ("tiebreak" in result && result.tiebreak) io.to(roomId).emit("tournament:tiebreakStarted", result);
      if (result.finished) io.to(roomId).emit("tournament:finished", result);
      else if (!("paused" in result)) io.to(roomId).emit("round:started", result);
      await emitSnapshots(roomId);
      if (!result.finished && !("paused" in result)) await startAutomaticIfNeeded(roomId);
    })(ack);
  });
  socket.on("card:toggleMark", async (payload: unknown, ack?: (result: unknown) => void) => {
    await guarded(false, async () => {
      const input = toggleMarkSchema.parse(payload);
      const marks = await toggleMark(roomId, playerId, input.cardId, input.cellIndex);
      socket.emit("card:marksUpdated", { cardId: input.cardId, marks });
      await emitSnapshots(roomId);
    })(ack);
  });
  socket.on("card:claimBingo", guarded(false, async () => {
    throw new AppError("BINGO_NOT_CONFIRMED", "El servidor valida el bingo automáticamente después de cada bolilla", 409);
  }));

  socket.on("disconnect", async () => {
    const sockets = connectedSockets.get(playerId);
    sockets?.delete(socket.id);
    if (sockets?.size) return;
    connectedSockets.delete(playerId);
    await prisma.player.update({ where: { id: playerId }, data: { connected: false, lastSeenAt: new Date() } }).catch(console.error);
    io.to(roomId).emit("room:playersUpdated");
    await emitSnapshots(roomId).catch(console.error);
  });
});

const cleanupTimer = setInterval(async () => {
  const cutoff = new Date(Date.now() - config.ROOM_TTL_HOURS * 60 * 60 * 1000);
  await prisma.room.deleteMany({ where: { status: { in: ["LOBBY", "FINISHED", "CANCELLED"] }, updatedAt: { lt: cutoff } } });
}, 60 * 60 * 1000);
cleanupTimer.unref();

if (process.env.NODE_ENV !== "test") {
  server.listen(config.PORT, () => console.log(`Servidor de Bingo Friends en http://localhost:${config.PORT}`));
}

async function shutdown() {
  automaticTimers.forEach(clearInterval);
  await prisma.$disconnect();
  server.close();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
