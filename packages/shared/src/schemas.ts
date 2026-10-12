import { z } from "zod";

export const nicknameSchema = z.string().trim().min(1, "Escribe un apodo").max(24).regex(/^[\p{L}\p{N} _.-]+$/u, "El apodo contiene caracteres no permitidos");
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{8}$/);
export const patternKindSchema = z.enum(["HORIZONTAL", "VERTICAL", "DIAGONAL", "L", "U", "X", "T", "CORNERS", "FULL", "CUSTOM"]);

export const roomSettingsSchema = z.object({
  maxPlayers: z.number().int().min(2).max(50).default(10),
  cardsPerPlayer: z.number().int().min(1).max(4).default(2),
  mode: z.enum(["SINGLE", "TOURNAMENT"]).default("TOURNAMENT"),
  regularRoundCount: z.number().int().min(1).max(30).default(5),
  drawMode: z.enum(["MANUAL", "AUTOMATIC"]).default("AUTOMATIC"),
  drawIntervalSeconds: z.union([z.literal(3), z.literal(5), z.literal(10)]).default(5),
  markMode: z.enum(["MANUAL", "AUTOMATIC"]).default("AUTOMATIC"),
  patternKind: patternKindSchema.default("HORIZONTAL"),
  customPattern: z.array(z.number().int().min(0).max(24)).max(25).optional(),
  patternPerRound: z.boolean().default(false),
}).superRefine((settings, ctx) => {
  if (settings.patternKind === "CUSTOM" && (!settings.customPattern || settings.customPattern.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customPattern"], message: "Selecciona al menos una casilla" });
  }
});

export const createRoomSchema = z.object({ nickname: nicknameSchema, settings: roomSettingsSchema });
export const joinRoomSchema = z.object({ nickname: nicknameSchema });
export const socketAuthSchema = z.object({ code: roomCodeSchema, token: z.string().min(32).max(256) });
export const toggleMarkSchema = z.object({ cardId: z.string().cuid(), cellIndex: z.number().int().min(0).max(24) });
export const nextRoundSchema = z.object({ patternKind: patternKindSchema.optional(), customPattern: z.array(z.number().int().min(0).max(24)).optional() });

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
