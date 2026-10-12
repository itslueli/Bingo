export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  console.error(error);
  return { code: "INTERNAL_ERROR", message: "Ocurrió un error inesperado" };
}
