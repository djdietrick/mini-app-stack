/**
 * Transport-agnostic error taxonomy.
 *
 * Domain code throws these; each adapter (Fastify, Express/Functions) maps them
 * onto HTTP. Nothing in apps/*\/src/domain should ever touch a reply object.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Optional structured payload, e.g. a flattened zod error. */
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "AppError";
  }

  /** The exact JSON body shape the current Fastify routes already return. */
  toBody(): { error: unknown } {
    return { error: this.details ?? this.code };
  }
}

export const badRequest = (code = "bad request", details?: unknown) =>
  new AppError(400, code, details);

export const unauthorized = (code = "not signed in") => new AppError(401, code);

export const forbidden = (code = "forbidden") => new AppError(403, code);

export const notFound = (code = "not found") => new AppError(404, code);

export const conflict = (code: string, details?: unknown) => new AppError(409, code, details);

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
