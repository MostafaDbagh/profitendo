import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function validateBody<T extends z.ZodType>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(new ApiError(422, 'VALIDATION_ERROR', 'Request data is invalid'));
    req.body = parsed.data;
    next();
  };
}
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    const metadata = error as { type?: string; status?: number; code?: string } | null;
    const type = metadata?.type;
    const known = error instanceof ApiError ? error
      : type === 'entity.parse.failed' ? new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON')
      : type === 'entity.too.large' ? new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
      : ['charset.unsupported', 'encoding.unsupported'].includes(type ?? '') ? new ApiError(415, 'UNSUPPORTED_ENCODING', 'Request encoding is not supported')
      : error instanceof URIError && metadata?.status === 400 ? new ApiError(400, 'INVALID_URL', 'Request URL is invalid')
      : metadata?.status === 400 && ['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes(metadata.code ?? '') ? new ApiError(400, 'INVALID_COMPRESSED_BODY', 'Compressed request body is invalid')
      : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    if (known.status >= 500) logger.error({ requestId: res.locals.requestId, code: known.code }, 'Request failed');
    // Preserve the legacy frontend detail field while adding stable machine codes.
    res.status(known.status).json({ error: { code: known.code }, detail: known.message, requestId: res.locals.requestId });
  };
}
