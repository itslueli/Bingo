import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

export function issueGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(`${config.TOKEN_PEPPER}:${token}`).digest("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateRoomCode(): string {
  return Array.from(randomBytes(8), (byte) => CODE_ALPHABET[byte! % CODE_ALPHABET.length]).join("");
}
