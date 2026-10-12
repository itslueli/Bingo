import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";
const settings = {
  maxPlayers: 4,
  cardsPerPlayer: 2,
  mode: "SINGLE",
  regularRoundCount: 1,
  drawMode: "MANUAL",
  drawIntervalSeconds: 5,
  markMode: "AUTOMATIC",
  patternKind: "HORIZONTAL",
  patternPerRound: false,
};

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.message ?? response.status}`);
  return result;
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Tiempo agotado esperando ${event}`));
    }, timeoutMs);
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

const host = await post("/api/rooms", { nickname: "AnfitrionSmoke", settings });
const guest = await post(`/api/rooms/${host.code}/join`, { nickname: "InvitadoSmoke" });
const hostSocket = io(baseUrl, { auth: { code: host.code, token: host.token }, transports: ["websocket"] });
const guestSocket = io(baseUrl, { auth: { code: guest.code, token: guest.token }, transports: ["websocket"] });

try {
  await Promise.all([waitFor(hostSocket, "connect"), waitFor(guestSocket, "connect")]);
  const hostStarted = waitFor(hostSocket, "room:snapshot", (snapshot) => snapshot.status === "IN_PROGRESS");
  const guestStarted = waitFor(guestSocket, "room:snapshot", (snapshot) => snapshot.status === "IN_PROGRESS");
  hostSocket.emit("room:start");
  const [hostSnapshot, guestSnapshot] = await Promise.all([hostStarted, guestStarted]);

  if (hostSnapshot.round.cards.length !== 2 || guestSnapshot.round.cards.length !== 2) throw new Error("Cantidad de cartillas incorrecta");
  if (hostSnapshot.round.cards.some((card) => guestSnapshot.round.cards.some((other) => other.id === card.id))) throw new Error("Se filtraron cartillas de otro jugador");

  const hostDrawn = waitFor(hostSocket, "room:snapshot", (snapshot) => snapshot.round?.drawnBalls.length === 1);
  const guestDrawn = waitFor(guestSocket, "room:snapshot", (snapshot) => snapshot.round?.drawnBalls.length === 1);
  hostSocket.emit("round:draw");
  const [afterDraw, guestAfterDraw] = await Promise.all([hostDrawn, guestDrawn]);
  if (afterDraw.round.currentBall !== guestAfterDraw.round.currentBall) throw new Error("Los clientes no recibieron la misma bolilla");

  console.log(JSON.stringify({
    ok: true,
    roomCode: host.code,
    players: hostSnapshot.players.length,
    cardsPerPlayer: hostSnapshot.round.cards.length,
    firstBall: afterDraw.round.currentBall,
    sequence: afterDraw.sequence,
  }, null, 2));
} finally {
  hostSocket.disconnect();
  guestSocket.disconnect();
}
