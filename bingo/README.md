# Bingo Friends — Especificación de implementación

## Estado de la implementación

MVP funcional implementado como monorepo npm: React/Vite en `apps/web`, Express/Socket.IO en `apps/server`, reglas y contratos compartidos en `packages/shared`, y PostgreSQL/Prisma en `prisma`.

### Puesta en marcha local

Requisitos: Node.js 20 o posterior, npm y Docker Desktop.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

En Windows PowerShell, el primer comando equivalente es `Copy-Item .env.example .env`. La web queda en `http://localhost:5173` y la API en `http://localhost:3001`.

Para probar con dos personas, abre la web, crea una sala y comparte la URL `/sala/CODIGO`. En la misma computadora usa dos perfiles o una ventana privada. Desde otro dispositivo de la red, sustituye `localhost` por la IP local del equipo anfitrión tanto en la URL como en `CLIENT_ORIGIN` y `VITE_SERVER_URL` dentro de `.env`; permite los puertos 5173 y 3001 en el firewall si fuese necesario.

### Verificación

```bash
npm test
npm run build
```

Las pruebas cubren generación válida y no repetida de cartillas/bolillas, patrones con casilla libre, ganadores simultáneos sin duplicados y reglas de desempate. Las pruebas integradas con PostgreSQL requieren que el contenedor esté levantado.

### Decisiones del MVP

- El servidor detecta el bingo inmediatamente después de cada bolilla incluso en marcado manual; las marcas son una ayuda visual y nunca deciden el resultado.
- Los snapshots de Socket.IO incluyen únicamente las cartillas del jugador autenticado.
- Las salas terminadas, canceladas o aún en lobby caducan según `ROOM_TTL_HOURS`; las activas no se eliminan.
- Para despliegue, sirve frontend y backend detrás de HTTPS, usa un `TOKEN_PEPPER` aleatorio, configura `CLIENT_ORIGIN` al dominio real y ejecuta `npm run db:deploy` durante la publicación.

### Publicación: Render + GitHub Pages

GitHub Pages aloja el frontend. El backend Socket.IO y PostgreSQL se despliegan en Render mediante el archivo `render.yaml` incluido.

1. Sube el repositorio a GitHub.
2. En Render elige **New > Blueprint**, conecta el repositorio y usa `render.yaml`.
3. Cuando Render solicite `CLIENT_ORIGIN`, escribe la URL de Pages sin `/` final: `https://TU_USUARIO.github.io/NOMBRE_REPO`.
4. Espera el despliegue y copia la URL del servicio, por ejemplo `https://bingo-friends-api.onrender.com`.
5. En GitHub abre **Settings > Secrets and variables > Actions > Variables** y crea `VITE_SERVER_URL` con esa URL de Render, sin `/` final.
6. En **Settings > Pages > Build and deployment > Source**, selecciona **GitHub Actions**.
7. Abre **Actions**, selecciona **Deploy frontend to GitHub Pages** y ejecútalo, o vuelve a hacer `push` a `main`.

El workflow detecta automáticamente el nombre del repositorio y configura el `base` de Vite. Los enlaces de invitación utilizan `#/sala/CODIGO`, por lo que funcionan al recargar una página alojada en GitHub Pages.

---

> **Instrucción para el agente de codificación:** Implementa una aplicación web funcional de bingo multijugador privado siguiendo esta especificación. No entregues únicamente un mockup. Prioriza un MVP completo, ejecutable localmente, con pruebas automatizadas de las reglas críticas. Si hay decisiones menores no especificadas, toma una decisión razonable, documéntala y continúa. No añadas funcionalidades públicas o de monetización.

## 1. Objetivo

Crear un bingo web para jugar entre amigos desde navegadores móviles o de escritorio, sin instalar aplicaciones ni registrarse. Cualquier participante puede crear una sala privada, configurar la partida o torneo y compartir un enlace o código. El sistema sortea bolillas, sincroniza las cartillas en tiempo real, valida ganadores y gestiona torneos con un único campeón.

Inspiración visual: bingo móvil de Plato (tablero 5×5, bolillas, historial, colores vivos), **sin copiar marcas, iconos ni recursos protegidos**. Interfaz original, responsive, accesible y en español.

### Fuera de alcance del MVP

- Salas públicas, matchmaking, perfiles y autenticación con correo.
- Rankings globales, pagos, apuestas, premios reales, chat de voz y monetización.
- App nativa Android/iOS.
- Escalado horizontal complejo y microservicios.

## 2. Stack técnico

- **Frontend:** React + TypeScript + Vite; CSS responsive (Tailwind CSS opcional).
- **Backend:** Node.js + TypeScript + Express + Socket.IO.
- **Base de datos:** PostgreSQL, con Prisma ORM y migraciones versionadas.
- **Validación:** Zod para entradas y contratos.
- **Pruebas:** Vitest para lógica de juego; Supertest y pruebas de integración Socket.IO para endpoints/eventos críticos.
- **Desarrollo local:** Docker Compose para PostgreSQL; scripts npm para ejecutar frontend y backend.

No usar Supabase como requisito. PostgreSQL es el almacenamiento persistente; Socket.IO se encarga de los eventos en tiempo real. Mantener la lógica autoritativa en el servidor.

## 3. Experiencia de usuario

### 3.1 Inicio

- Botones **Crear sala** y **Unirse a sala**.
- Unirse mediante enlace `https://dominio/sala/CODIGO` o introduciendo el código.
- Solicitar solo apodo (sin cuenta). Persistir identificador de sesión de invitado en almacenamiento local y usar un token de reconexión seguro; no confiar en un `playerId` editable por el cliente.

### 3.2 Crear sala

El anfitrión puede configurar:

- Número máximo de jugadores: entero configurable, por defecto 10; mínimo 2. **Se puede iniciar con cualquier cantidad de participantes, incluidos números impares**, desde 2, sin completar el máximo. No se crean jugadores ficticios.
- Cartillas por jugador: 1–4 inicialmente, por defecto 2. Todos reciben la misma cantidad en el MVP.
- Modalidad: partida única o torneo.
- Número de rondas regulares del torneo: 3, 5, 10 o personalizado (1–30), por defecto 5.
- Bolillas: automáticas (intervalo configurable, por ejemplo 3, 5 o 10 segundos) o manuales por anfitrión.
- Marcado de casillas: automático o manual. En modo manual, el servidor valida siempre usando las bolillas sorteadas; las marcas del usuario no determinan por sí solas una victoria.
- Patrón ganador: línea horizontal, vertical, diagonal, L, U, X, T, cuatro esquinas, cartón lleno o patrón personalizado en cuadrícula 5×5.
- Patrón por ronda: permitir elegir uno fijo para todo el torneo o cambiarlo entre rondas antes de iniciarlas.

Mostrar resumen de configuración antes de crear. Generar código de sala difícil de adivinar, no secuencial, y enlace para compartir.

### 3.3 Sala de espera

- Lista de jugadores conectados y sus apodos.
- Identificar al anfitrión.
- El anfitrión inicia con al menos dos jugadores conectados.
- Si alguien se desconecta, mostrar su estado y permitir reconexión.
- Solo el anfitrión puede iniciar, pausar, reanudar y avanzar rondas; autorizar estas acciones en backend.

### 3.4 Pantalla de juego

- Cartillas B-I-N-G-O de 5×5; centro libre.
- Mostrar cartillas múltiples en pestañas o carrusel cómodo para celular.
- Bolilla actual destacada, historial de bolillas y cantidad restante.
- Estado de conexión y número de ronda.
- En marcado manual, permitir marcar/desmarcar números, pero **solo se considera válido un número que ya salió**. Mostrar visualmente números llamados y marcas realizadas.
- Botón **BINGO** opcional en modo manual, con validación autoritativa del servidor. En modo automático, detectar el ganador sin botón.
- Mostrar animación moderada de victoria, nombres de todos los ganadores y tabla del torneo.
- Evitar que un jugador vea las cartillas ajenas durante una ronda, salvo datos públicos necesarios para la clasificación.

## 4. Reglas del bingo

### 4.1 Cartillas y bolillas

- Bingo estadounidense de **75 bolillas**, números 1–75 sin repetición por ronda.
- B: 1–15; I: 16–30; N: 31–45; G: 46–60; O: 61–75.
- Cada columna contiene 5 valores únicos de su rango, excepto N con 4 números y casilla central **LIBRE**.
- Cada cartilla tiene distribución aleatoria válida; evitar cartillas idénticas dentro de la misma ronda si es posible.
- El servidor genera cartillas y secuencia de bolillas con aleatoriedad segura; no confiar en sorteos realizados por clientes.
- El espacio central LIBRE cuenta siempre como completado al evaluar patrones.

### 4.2 Patrones

- Representar un patrón como conjunto de índices de celda `0..24`, fila por fila.
- Para patrones con variantes (línea horizontal/vertical/diagonal), una victoria ocurre si se completa **cualquiera** de las variantes válidas.
- Para L, U, X, T y patrones personalizados, guardar explícitamente las celdas requeridas; documentar orientación de los patrones predeterminados.
- Editor visual 5×5 para patrones personalizados; validar que no esté vacío. La casilla LIBRE está siempre cubierta, aunque no forme parte de las celdas requeridas.
- Un patrón está completo si todas sus celdas requeridas están cubiertas por bolillas ya sorteadas o por la casilla LIBRE.

### 4.3 Ganadores simultáneos — regla obligatoria

**Victoria compartida:** si dos o más jugadores completan el patrón con la misma bolilla, **todos reciben una victoria completa** en esa ronda. Nunca usar la velocidad de pulsar BINGO ni el orden de recepción de mensajes para desempatar.

Implementación requerida:

1. Registrar atómicamente la siguiente bolilla.
2. Evaluar **todas** las cartillas activas contra el conjunto de bolillas sorteadas, inmediatamente después de cada sorteo.
3. Reunir el conjunto de `playerId` ganadores, sin duplicados.
4. Si hay al menos un ganador, finalizar la ronda una sola vez y guardar todos los ganadores en una transacción.
5. Emitir el mismo resultado oficial a todos los clientes.

Un jugador con dos o más cartillas ganadoras obtiene **solo una victoria por ronda**. Si se usa el botón BINGO manual, el resultado oficial sigue siendo el calculado por el servidor; el botón no otorga prioridad.

### 4.4 Fin de ronda sin bingo

Si se agotan las 75 bolillas sin ganador, finalizar sin ganador y registrar el resultado. En cartón lleno esto no debería ocurrir con cartillas válidas, pero el servidor debe manejar el caso.

## 5. Torneos y campeón único

- Cada torneo tiene `N` rondas **regulares**, por defecto 5.
- Cada ronda ganada suma **1 victoria** a cada jugador ganador, incluso si la victoria es compartida. La suma total de victorias puede superar el número de rondas.
- Al terminar las `N` rondas, ordenar por victorias acumuladas.
- Si hay un único líder, declararlo campeón.
- Si hay empate en el primer lugar, iniciar **rondas adicionales de desempate** exclusivamente entre los jugadores empatados en el primer puesto.
- En cada desempate generar cartillas nuevas y reiniciar el conjunto de bolillas; aplicar la misma regla de victoria compartida.
- Si hay un único ganador en una ronda de desempate, declararlo campeón.
- Si vuelve a haber victoria compartida, continuar con otra ronda de desempate entre los ganadores de esa ronda; si no hay ganador, repetir con los mismos finalistas.
- Los desempates **no modifican las victorias de las rondas regulares**: registrar sus resultados por separado.
- El torneo **nunca se declara finalizado con varios campeones**. Si se interrumpe, queda pausado/pendiente de desempate, no se inventa un campeón.
- Si un finalista se desconecta, pausar antes de iniciar la siguiente ronda; permitir reconexión y reanudación por el anfitrión. No asignar derrota automática por desconexión en el MVP.
- Mostrar historial de rondas, victorias, empates y campeón final.

Ejemplo: cinco rondas, A gana 3, B gana 3 y C gana 1 (porque hubo victorias compartidas). A y B juegan desempates hasta que uno gane en solitario.

## 6. Estados y concurrencia

Modelar sala/torneo con máquina de estados explícita, por ejemplo:

`LOBBY -> IN_PROGRESS -> ROUND_RESULT -> (NEXT_ROUND | TIEBREAK | FINISHED)`

Estados auxiliares: `PAUSED`, `CANCELLED`.

Requisitos:

- Sorteos y cierre de rondas serializados en backend; proteger contra dos bolillas simultáneas y doble finalización.
- El cliente nunca decide qué bolilla salió, quién ganó o cuántas victorias lleva.
- Todos los eventos importantes tienen identificador, número de ronda y versión/secuencia monotónica para evitar aplicar eventos viejos.
- Al reconectar, enviar snapshot completo y coherente del estado autorizado.
- En modo automático, usar un único temporizador por sala en el servidor y detenerlo al pausar/finalizar.
- Implementar limpieza de salas abandonadas y caducidad configurable, sin eliminar torneos activos accidentalmente.

## 7. Modelo de datos PostgreSQL

Crear migraciones Prisma para al menos:

- `Room`: id, code único, hostPlayerId, settings JSONB validado, status, createdAt, updatedAt.
- `Player`: id, roomId, nickname, reconnectTokenHash, connected, joinedAt, lastSeenAt.
- `Tournament`: id, roomId, regularRoundCount, status, championPlayerId nullable, createdAt, finishedAt.
- `Round`: id, tournamentId nullable, roomId, ordinal, phase (`REGULAR`/`TIEBREAK`/`SINGLE`), pattern JSONB, drawMode, status, startedAt, endedAt.
- `Card`: id, roundId, playerId, cardIndex, cells JSONB (25 posiciones, centro libre).
- `Draw`: id, roundId, number, drawOrder, createdAt; índices únicos `(roundId, number)` y `(roundId, drawOrder)`.
- `RoundWinner`: roundId, playerId; clave compuesta única.
- `TournamentResult`: tournamentId, playerId, regularWins, placement nullable.

Asegurar integridad referencial, índices de consultas frecuentes y transacciones para registrar sorteos, ganadores y resultados. Evitar guardar contraseñas en texto plano; no se requieren contraseñas para el MVP.

## 8. API y eventos Socket.IO

Definir contratos tipados y validados. Nombres sugeridos:

### HTTP

- `POST /api/rooms` — crear sala y anfitrión.
- `POST /api/rooms/:code/join` — unirse como invitado.
- `GET /api/rooms/:code` — datos públicos de la sala.
- `GET /api/health` — salud del servicio.

### Socket.IO

Cliente -> servidor:

- `room:join`, `room:reconnect`
- `room:start`, `room:pause`, `room:resume`
- `round:draw` (solo anfitrión en modo manual)
- `round:next` (solo anfitrión)
- `card:toggleMark` (solo propia cartilla, modo manual)
- `card:claimBingo` (opcional; nunca determina precedencia)

Servidor -> clientes:

- `room:snapshot`, `room:playersUpdated`, `room:statusChanged`
- `round:started`, `round:ballDrawn`, `round:paused`, `round:ended`
- `tournament:standings`, `tournament:tiebreakStarted`, `tournament:finished`
- `error:action` con código de error claro.

Autenticar cada socket mediante token de invitado vinculado a la sala; validar pertenencia y rol del anfitrión. No filtrar cartillas de otros jugadores en snapshots.

## 9. Interfaz y accesibilidad

Pantallas mínimas:

1. Inicio.
2. Crear sala y configurar torneo.
3. Unirse con código y apodo.
4. Sala de espera.
5. Juego con cartillas, bolilla actual e historial.
6. Editor de patrones 5×5.
7. Resultado de ronda (incluyendo varios ganadores).
8. Clasificación, desempate y campeón final.

Requisitos UX:

- Mobile-first, botones táctiles grandes, tipografía legible y contraste suficiente.
- Estados de carga, error, desconexión y reconexión.
- Indicadores no basados solo en color.
- Mensajes en español y navegación clara.
- Mostrar si una sala está llena, ya empezó o expiró.

## 10. Seguridad básica

- Sanitizar apodos, limitar longitud y validar todos los payloads.
- Rate limiting para crear/unirse a salas y acciones sensibles.
- Códigos de sala aleatorios y no enumerables; enlaces privados no equivalen a autenticación fuerte.
- Tokens de reconexión suficientemente aleatorios; almacenar hash del token en DB.
- CORS configurado para frontend permitido; secretos solo en variables de entorno.
- No exponer credenciales de PostgreSQL en frontend.
- Autorización de anfitrión comprobada en backend para cada operación privilegiada.
- Evitar que un cliente falsifique resultados, bolillas o acciones de otros jugadores.

## 11. Estructura sugerida

```text
bingo-friends/
├── README.md
├── docker-compose.yml
├── .env.example
├── package.json
├── apps/
│   ├── web/                 # React + Vite + TypeScript
│   └── server/              # Express + Socket.IO + TypeScript
├── packages/
│   └── shared/              # Tipos, contratos Zod, reglas compartidas sin autoridad
├── prisma/
│   ├── schema.prisma
│   └── migrations/
└── tests/
    ├── game/
    └── integration/
```

Puede adaptarse la estructura si se mantiene separación clara entre interfaz, lógica de dominio, servidor y persistencia.

## 12. Entrega y ejecución local

El agente debe incluir:

- Código fuente completo, sin pseudocódigo en funciones principales.
- `.env.example` con `DATABASE_URL`, `PORT`, `CLIENT_ORIGIN` y secretos necesarios, sin credenciales reales.
- `docker-compose.yml` para levantar PostgreSQL.
- Migraciones Prisma reproducibles.
- Scripts para instalar dependencias, migrar DB, ejecutar desarrollo y pruebas.
- Instrucciones exactas para arrancar frontend y backend, con puertos definidos.
- Instrucciones para probar con **dos navegadores/dispositivos** en la misma red y notas para despliegue posterior.
- Manejo de errores y logging básico.
- No afirmar que funciona sin ejecutar pruebas; documentar claramente qué se verificó y qué quedó pendiente.

### Comandos esperados (ajustables)

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
npm test
```

## 13. Pruebas obligatorias / criterios de aceptación

1. Crear sala para máximo 4 personas, entrar con **3 jugadores** y comenzar sin cuarto jugador.
2. Entrar a la sala desde tres navegadores; los tres reciben las mismas bolillas en el mismo orden.
3. Las cartillas respetan rangos B-I-N-G-O, números únicos por columna y centro LIBRE.
4. No se repite una bolilla dentro de la misma ronda.
5. Dos jugadores completan patrón con **la misma bolilla**: ambos aparecen como ganadores y ambos reciben +1 victoria.
6. Un jugador gana con dos cartillas a la vez: recibe solo +1 victoria.
7. Un cliente intenta falsificar un sorteo, ganador o acción de anfitrión: el servidor lo rechaza.
8. Un patrón personalizado se evalúa correctamente, incluyendo centro LIBRE.
9. Torneo de 5 rondas termina con líder único: se declara campeón.
10. Torneo de 5 rondas termina con líderes empatados: se inicia desempate; si empatan otra vez, se repite; solo termina al existir un ganador único.
11. Desconectar/reconectar un jugador conserva su identidad y sus cartillas de la ronda.
12. Refrescar el navegador reconstruye el estado desde el servidor sin duplicar bolillas o victorias.
13. Dos solicitudes simultáneas para sacar bolilla no generan sorteos duplicados ni doble cierre de ronda.
14. Interfaz utilizable en ancho móvil de ~360 px.
15. Los datos persistentes de torneos y resultados sobreviven a un reinicio del backend.

## 14. Orden de implementación

1. Inicializar monorepo, PostgreSQL, Prisma y tipos compartidos.
2. Implementar motor de bingo **puro y testeable**: cartillas, bolillas, patrones, evaluación de todos los ganadores.
3. Implementar torneos, victorias compartidas y desempates con pruebas.
4. Crear API de salas y tokens de invitados.
5. Integrar Socket.IO y máquina de estados del servidor.
6. Construir UI responsive y editor de patrones.
7. Integrar reconexión, persistencia, validación y seguridad básica.
8. Ejecutar pruebas automáticas y una prueba manual multijugador.
9. Documentar ejecución y despliegue.

## 15. Definición de terminado

El MVP está terminado cuando **tres amigos pueden abrir la web, crear una sala privada, recibir sus cartillas, jugar en tiempo real y completar un torneo de cinco rondas**, con victorias compartidas si dos jugadores hacen bingo con la misma bolilla y desempates sucesivos hasta obtener **un solo campeón**. Debe funcionar con PostgreSQL local, sin Supabase, sin registro y sin servicios de pago obligatorios durante el desarrollo.

---

**Nota al agente:** Ante dudas menores, implementa la alternativa más sencilla que preserve estas reglas. Da prioridad a la corrección del motor y la sincronización antes que a las animaciones. Al finalizar, resume archivos creados, comandos ejecutados, pruebas aprobadas, limitaciones y próximos pasos.
