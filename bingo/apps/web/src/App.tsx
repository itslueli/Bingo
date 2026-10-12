import { FormEvent, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PatternKind, RoomSettings, RoomSnapshot } from "@bingo/shared";

const SERVER = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const BASE = import.meta.env.BASE_URL;
const LETTERS = ["B", "I", "N", "G", "O"];
const PATTERNS: { value: PatternKind; label: string }[] = [
  { value: "HORIZONTAL", label: "Línea horizontal" }, { value: "VERTICAL", label: "Línea vertical" },
  { value: "DIAGONAL", label: "Diagonal" }, { value: "L", label: "Forma L" }, { value: "U", label: "Forma U" },
  { value: "X", label: "Forma X" }, { value: "T", label: "Forma T" }, { value: "CORNERS", label: "Cuatro esquinas" },
  { value: "FULL", label: "Cartón lleno" }, { value: "CUSTOM", label: "Personalizado" },
];

type Credentials = { code: string; token: string; playerId: string };
type View = "home" | "create" | "join" | "room";

const defaults: RoomSettings = {
  maxPlayers: 10, cardsPerPlayer: 2, mode: "TOURNAMENT", regularRoundCount: 5,
  drawMode: "AUTOMATIC", drawIntervalSeconds: 5, markMode: "AUTOMATIC",
  patternKind: "HORIZONTAL", patternPerRound: false,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "No se pudo completar la acción");
  return body;
}

export default function App() {
  const pathCode = (location.hash.match(/^#\/sala\/([A-Za-z2-9]{8})/)?.[1]
    ?? location.pathname.match(/\/sala\/([A-Za-z2-9]{8})/)?.[1])?.toUpperCase();
  const [view, setView] = useState<View>(pathCode ? "join" : "home");
  const [credentials, setCredentials] = useState<Credentials | null>(() => {
    try { return JSON.parse(localStorage.getItem("bingo-session") ?? "null"); } catch { return null; }
  });
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [online, setOnline] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!credentials) return;
    history.replaceState(null, "", `${BASE}#/sala/${credentials.code}`);
    localStorage.setItem("bingo-session", JSON.stringify(credentials));
    setView("room");
    const next = io(SERVER, { auth: { code: credentials.code, token: credentials.token }, reconnection: true });
    next.on("connect", () => { setOnline(true); setMessage(""); });
    next.on("disconnect", () => setOnline(false));
    next.on("connect_error", (error) => setMessage(error.message));
    next.on("room:snapshot", setSnapshot);
    next.on("error:action", (error: { message: string }) => setMessage(error.message));
    setSocket(next);
    return () => { next.disconnect(); setSocket(null); };
  }, [credentials]);

  const leave = () => {
    socket?.disconnect();
    localStorage.removeItem("bingo-session");
    history.replaceState(null, "", BASE);
    setCredentials(null); setSnapshot(null); setView("home"); setMessage("");
  };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => !credentials && setView("home")} aria-label="Ir al inicio">
        <span className="brand-mark">B</span><span>Bingo <i>Friends</i></span>
      </button>
      {view === "room" && <div className={`connection ${online ? "online" : "offline"}`}><span />{online ? "Conectado" : "Reconectando…"}</div>}
    </header>
    <main>
      {message && <div className="toast" role="alert"><span>{message}</span><button onClick={() => setMessage("")}>×</button></div>}
      {view === "home" && <Home onCreate={() => setView("create")} onJoin={() => setView("join")} />}
      {view === "create" && <CreateRoom onBack={() => setView("home")} onDone={setCredentials} onError={setMessage} />}
      {view === "join" && <JoinRoom initialCode={pathCode ?? ""} onBack={() => setView("home")} onDone={setCredentials} onError={setMessage} />}
      {view === "room" && <Room snapshot={snapshot} socket={socket} online={online} onLeave={leave} onError={setMessage} />}
    </main>
  </div>;
}

function Home({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <section className="hero page">
    <div className="hero-copy">
      <p className="eyebrow">TU NOCHE DE JUEGO, EN CUALQUIER LUGAR</p>
      <h1>La suerte se disfruta <em>entre amigos.</em></h1>
      <p className="lede">Crea una sala privada, comparte el código y empieza a jugar. Sin cuentas, sin instalaciones, sin complicaciones.</p>
      <div className="hero-actions"><button className="primary large" onClick={onCreate}>Crear una sala <span>→</span></button><button className="secondary large" onClick={onJoin}>Unirme con código</button></div>
      <div className="trust"><span>✓ Gratis</span><span>✓ Hasta 50 jugadores</span><span>✓ Móvil y escritorio</span></div>
    </div>
    <div className="hero-art" aria-hidden="true">
      <div className="sun"/><div className="ball ball-8">8</div><div className="ball ball-31">31</div><div className="ball ball-67">67</div>
      <div className="mini-card"><div className="mini-head">B I N G O</div>{Array.from({ length: 25 }, (_, i) => <span className={i === 12 ? "free" : [1, 5, 10, 15, 20].includes(i) ? "hit" : ""} key={i}>{i === 12 ? "★" : (i * 7) % 75 + 1}</span>)}</div>
    </div>
    <div className="feature-strip"><article><b>01</b><div><strong>Crea</strong><small>Configura la partida a tu gusto.</small></div></article><article><b>02</b><div><strong>Invita</strong><small>Comparte un código privado.</small></div></article><article><b>03</b><div><strong>¡Bingo!</strong><small>Juega sincronizado en tiempo real.</small></div></article></div>
  </section>;
}

function CreateRoom({ onBack, onDone, onError }: { onBack: () => void; onDone: (c: Credentials) => void; onError: (s: string) => void }) {
  const [nickname, setNickname] = useState("");
  const [settings, setSettings] = useState(defaults);
  const [custom, setCustom] = useState<number[]>([0, 4, 12, 20, 24]);
  const [loading, setLoading] = useState(false);
  const change = <K extends keyof RoomSettings>(key: K, value: RoomSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true);
    try { onDone(await request<Credentials>("/api/rooms", { method: "POST", body: JSON.stringify({ nickname, settings: { ...settings, customPattern: settings.patternKind === "CUSTOM" ? custom : undefined } }) })); }
    catch (error) { onError(error instanceof Error ? error.message : "No se pudo crear la sala"); setLoading(false); }
  };
  return <section className="page form-page"><Back onClick={onBack}/><div className="page-heading"><p className="eyebrow">NUEVA PARTIDA</p><h1>Prepara la mesa</h1><p>Elige las reglas. Podrás compartir la sala en el siguiente paso.</p></div>
    <form className="settings-grid" onSubmit={submit}>
      <fieldset className="panel"><legend>Tu identidad</legend><label>Apodo<input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required placeholder="¿Cómo te llamamos?" /></label></fieldset>
      <fieldset className="panel"><legend>La sala</legend><div className="two-cols"><label>Máximo de jugadores<input type="number" min="2" max="50" value={settings.maxPlayers} onChange={(e) => change("maxPlayers", Number(e.target.value))}/></label><label>Cartillas por jugador<select value={settings.cardsPerPlayer} onChange={(e) => change("cardsPerPlayer", Number(e.target.value))}>{[1,2,3,4].map(n => <option key={n}>{n}</option>)}</select></label></div></fieldset>
      <fieldset className="panel"><legend>Modalidad</legend><div className="segmented"><button type="button" className={settings.mode === "SINGLE" ? "active" : ""} onClick={() => change("mode", "SINGLE")}>Partida única</button><button type="button" className={settings.mode === "TOURNAMENT" ? "active" : ""} onClick={() => change("mode", "TOURNAMENT")}>Torneo</button></div>{settings.mode === "TOURNAMENT" && <label>Rondas regulares<input type="number" min="1" max="30" value={settings.regularRoundCount} onChange={(e) => change("regularRoundCount", Number(e.target.value))}/></label>}</fieldset>
      <fieldset className="panel"><legend>Ritmo de juego</legend><div className="two-cols"><label>Sorteo<select value={settings.drawMode} onChange={(e) => change("drawMode", e.target.value as RoomSettings["drawMode"])}><option value="AUTOMATIC">Automático</option><option value="MANUAL">Manual</option></select></label><label>Marcado<select value={settings.markMode} onChange={(e) => change("markMode", e.target.value as RoomSettings["markMode"])}><option value="AUTOMATIC">Automático</option><option value="MANUAL">Manual</option></select></label></div>{settings.drawMode === "AUTOMATIC" && <label>Segundos entre bolillas<select value={settings.drawIntervalSeconds} onChange={(e) => change("drawIntervalSeconds", Number(e.target.value) as 3|5|10)}><option>3</option><option>5</option><option>10</option></select></label>}</fieldset>
      <fieldset className="panel pattern-panel"><legend>Patrón ganador</legend><div className="pattern-options">{PATTERNS.map(p => <button type="button" className={settings.patternKind === p.value ? "selected" : ""} onClick={() => change("patternKind", p.value)} key={p.value}>{p.label}</button>)}</div>{settings.patternKind === "CUSTOM" && <PatternEditor value={custom} onChange={setCustom}/>}<label className="check"><input type="checkbox" checked={settings.patternPerRound} onChange={(e) => change("patternPerRound", e.target.checked)}/> Permitir cambiar el patrón entre rondas</label></fieldset>
      <div className="form-submit"><div><strong>Todo listo</strong><small>Podrás iniciar cuando haya 2 jugadores conectados.</small></div><button className="primary large" disabled={loading}>{loading ? "Creando…" : "Crear sala →"}</button></div>
    </form>
  </section>;
}

function JoinRoom({ initialCode, onBack, onDone, onError }: { initialCode: string; onBack: () => void; onDone: (c: Credentials) => void; onError: (s: string) => void }) {
  const [code, setCode] = useState(initialCode); const [nickname, setNickname] = useState(""); const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); try { onDone(await request<Credentials>(`/api/rooms/${code.toUpperCase()}/join`, { method: "POST", body: JSON.stringify({ nickname }) })); } catch (error) { onError(error instanceof Error ? error.message : "No se pudo entrar"); setLoading(false); } };
  return <section className="page form-page narrow"><Back onClick={onBack}/><div className="page-heading"><p className="eyebrow">ENTRAR A UNA SALA</p><h1>La mesa te espera</h1><p>Usa el código que te compartió el anfitrión.</p></div><form className="panel join-form" onSubmit={submit}><label>Código de sala<input className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z2-9]/g, "").slice(0, 8).toUpperCase())} minLength={8} required placeholder="ABCD2345"/></label><label>Tu apodo<input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required placeholder="¿Cómo te llamamos?"/></label><button className="primary large" disabled={loading}>{loading ? "Entrando…" : "Entrar a jugar →"}</button></form></section>;
}

function Room({ snapshot, socket, online, onLeave, onError }: { snapshot: RoomSnapshot | null; socket: Socket | null; online: boolean; onLeave: () => void; onError: (s: string) => void }) {
  const [copied, setCopied] = useState(false); const [tab, setTab] = useState(0);
  const self = snapshot?.players.find(p => p.id === snapshot.selfPlayerId); const isHost = self?.isHost ?? false;
  const act = (event: string, payload?: unknown) => { if (!socket || !online) return onError("Todavía no hay conexión con el servidor"); socket.emit(event, payload ?? {}); };
  const copy = async () => { await navigator.clipboard.writeText(`${location.origin}${BASE}#/sala/${snapshot?.code}`); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  if (!snapshot) return <div className="loading"><div className="spinner"/><p>Preparando tu cartilla…</p></div>;
  const winnerNames = snapshot.round?.winnerIds.map(id => snapshot.players.find(p => p.id === id)?.nickname).filter(Boolean) ?? [];
  return <section className="room-page">
    <div className="room-toolbar"><div><span className="muted-label">CÓDIGO DE SALA</span><button className="room-code" onClick={copy}>{snapshot.code}<span>{copied ? "✓" : "⧉"}</span></button></div><div className="toolbar-actions"><button className="ghost" onClick={copy}>{copied ? "Enlace copiado" : "Compartir enlace"}</button><button className="ghost danger" onClick={onLeave}>Salir</button></div></div>
    {snapshot.status === "LOBBY" && <Lobby snapshot={snapshot} isHost={isHost} onStart={() => act("room:start")}/>} 
    {["IN_PROGRESS", "PAUSED"].includes(snapshot.status) && snapshot.round && <Game snapshot={snapshot} isHost={isHost} tab={tab} setTab={setTab} act={act}/>} 
    {snapshot.status === "ROUND_RESULT" && <Results snapshot={snapshot} isHost={isHost} winnerNames={winnerNames as string[]} onNext={() => act("round:next")}/>} 
    {snapshot.status === "FINISHED" && <Finished snapshot={snapshot}/>} 
  </section>;
}

function Lobby({ snapshot, isHost, onStart }: { snapshot: RoomSnapshot; isHost: boolean; onStart: () => void }) {
  const connected = snapshot.players.filter(p => p.connected).length;
  return <div className="lobby-layout"><div className="lobby-main"><p className="eyebrow">SALA DE ESPERA</p><h1>Reuniendo a la banda</h1><p className="lede">Comparte el enlace. La partida puede comenzar en cuanto haya dos personas conectadas.</p><div className="players-head"><h2>Jugadores</h2><span>{connected}/{snapshot.settings.maxPlayers} conectados</span></div><div className="player-list">{snapshot.players.map((player, i) => <article key={player.id}><span className={`avatar a${i%5}`}>{player.nickname.slice(0,1).toUpperCase()}</span><div><strong>{player.nickname}{player.id === snapshot.selfPlayerId && " (tú)"}</strong><small>{player.isHost ? "Anfitrión" : "Jugador"}</small></div><span className={`status-dot ${player.connected ? "yes" : "no"}`}>{player.connected ? "Conectado" : "Desconectado"}</span></article>)}</div>{isHost ? <button className="primary large full" disabled={connected < 2} onClick={onStart}>{connected < 2 ? "Esperando a otro jugador…" : "Empezar partida →"}</button> : <div className="waiting"><span className="pulse"/> Esperando a que el anfitrión inicie…</div>}</div><aside className="rules-card"><p className="eyebrow">REGLAS DE ESTA MESA</p><Rule label="Modalidad" value={snapshot.settings.mode === "TOURNAMENT" ? `Torneo · ${snapshot.settings.regularRoundCount} rondas` : "Partida única"}/><Rule label="Cartillas" value={`${snapshot.settings.cardsPerPlayer} por jugador`}/><Rule label="Sorteo" value={snapshot.settings.drawMode === "AUTOMATIC" ? `Cada ${snapshot.settings.drawIntervalSeconds} segundos` : "Por el anfitrión"}/><Rule label="Marcado" value={snapshot.settings.markMode === "AUTOMATIC" ? "Automático" : "Manual"}/><Rule label="Patrón" value={PATTERNS.find(p => p.value === snapshot.settings.patternKind)?.label ?? "Personalizado"}/></aside></div>;
}

function Game({ snapshot, isHost, tab, setTab, act }: { snapshot: RoomSnapshot; isHost: boolean; tab: number; setTab: (n: number) => void; act: (e: string, p?: unknown) => void }) {
  const round = snapshot.round!; const card = round.cards[tab] ?? round.cards[0]; const drawn = new Set(round.drawnBalls);
  return <div className="game-layout"><section className="game-main"><div className="round-head"><div><p className="eyebrow">{round.phase === "TIEBREAK" ? "DESEMPATE" : `RONDA ${round.ordinal}`}</p><h1>{round.pattern.label}</h1></div><div className="host-controls">{isHost && snapshot.status === "IN_PROGRESS" && <button className="secondary" onClick={() => act("room:pause")}>Ⅱ Pausar</button>}{isHost && snapshot.status === "PAUSED" && <button className="primary" onClick={() => act("room:resume")}>Reanudar</button>}{isHost && snapshot.settings.drawMode === "MANUAL" && snapshot.status === "IN_PROGRESS" && <button className="primary" onClick={() => act("round:draw")}>Sacar bolilla</button>}</div></div>{snapshot.status === "PAUSED" && <div className="pause-banner">Partida en pausa</div>}{round.cards.length > 1 && <div className="card-tabs">{round.cards.map((_, i) => <button className={tab === i ? "active" : ""} onClick={() => setTab(i)} key={i}>Cartilla {i+1}</button>)}</div>}{card && <BingoCard card={card} drawn={drawn} manual={snapshot.settings.markMode === "MANUAL"} onCell={(cellIndex) => act("card:toggleMark", { cardId: card.id, cellIndex })}/>}</section><aside className="draw-panel"><div className="current-ball"><span>ÚLTIMA BOLILLA</span><b>{round.currentBall ?? "—"}</b><small>{round.remainingCount} restantes</small></div><div className="history"><h3>Historial <span>{round.drawnBalls.length}/75</span></h3><div>{round.drawnBalls.slice().reverse().map((ball, i) => <span className={i === 0 ? "latest" : ""} key={ball}>{ball}</span>)}</div>{!round.drawnBalls.length && <p>Aún no salió ninguna bolilla.</p>}</div><Standings snapshot={snapshot}/></aside></div>;
}

function BingoCard({ card, drawn, manual, onCell }: { card: NonNullable<RoomSnapshot["round"]>["cards"][number]; drawn: Set<number>; manual: boolean; onCell: (i: number) => void }) {
  const marked = new Set(card.marked);
  return <div className="bingo-wrap"><div className="bingo-title">{LETTERS.map(l => <span key={l}>{l}</span>)}</div><div className="bingo-card">{card.cells.map((cell, index) => { const called = cell === "FREE" || drawn.has(cell); const selected = marked.has(index); return <button key={index} disabled={!manual || !called || cell === "FREE"} onClick={() => onCell(index)} className={`${called ? "called" : ""} ${selected ? "marked" : ""} ${cell === "FREE" ? "free" : ""}`}><span>{cell === "FREE" ? "★" : cell}</span>{cell === "FREE" && <small>LIBRE</small>}</button>; })}</div><p className="card-help">{manual ? "Toca los números que ya salieron para marcarlos." : "Tus números se marcan automáticamente."}</p></div>;
}

function Results({ snapshot, isHost, winnerNames, onNext }: { snapshot: RoomSnapshot; isHost: boolean; winnerNames: string[]; onNext: () => void }) {
  return <div className="result-page"><div className="celebration">★</div><p className="eyebrow">RONDA TERMINADA</p><h1>{winnerNames.length ? (winnerNames.length > 1 ? "¡Victoria compartida!" : "¡Tenemos bingo!") : "Ronda sin ganador"}</h1><p className="winners">{winnerNames.length ? winnerNames.join(" · ") : "Se agotaron las bolillas."}</p><Standings snapshot={snapshot}/>{isHost ? <button className="primary large" onClick={onNext}>{snapshot.settings.mode === "SINGLE" ? "Ver resultado final" : "Continuar →"}</button> : <div className="waiting"><span className="pulse"/> Esperando al anfitrión…</div>}</div>;
}

function Finished({ snapshot }: { snapshot: RoomSnapshot }) {
  const champion = snapshot.players.find(p => p.id === snapshot.championPlayerId);
  return <div className="result-page champion"><div className="trophy">♛</div><p className="eyebrow">PARTIDA FINALIZADA</p><h1>{champion ? `${champion.nickname} es campeón` : "¡Gran partida!"}</h1><p>Gracias por compartir esta mesa.</p><Standings snapshot={snapshot}/><button className="secondary large" onClick={() => location.reload()}>Volver a ver la sala</button></div>;
}

function Standings({ snapshot }: { snapshot: RoomSnapshot }) { if (!snapshot.standings.length) return null; return <div className="standings"><h3>Clasificación</h3>{snapshot.standings.map((row, i) => <div key={row.playerId}><b>{i+1}</b><span>{row.nickname}{row.playerId === snapshot.selfPlayerId && " (tú)"}</span><strong>{row.regularWins} {row.regularWins === 1 ? "victoria" : "victorias"}</strong></div>)}</div>; }
function Rule({ label, value }: { label: string; value: string }) { return <div className="rule"><span>{label}</span><strong>{value}</strong></div>; }
function Back({ onClick }: { onClick: () => void }) { return <button className="back" onClick={onClick}>← Volver</button>; }
function PatternEditor({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) { const chosen = new Set(value); return <div className="pattern-editor" aria-label="Editor de patrón personalizado">{Array.from({ length: 25 }, (_, i) => <button type="button" className={chosen.has(i) ? "on" : ""} key={i} onClick={() => onChange(chosen.has(i) ? value.filter(v => v !== i) : [...value, i])}>{i === 12 ? "★" : ""}</button>)}</div>; }
