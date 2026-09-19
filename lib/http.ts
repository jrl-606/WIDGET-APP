import { NextResponse } from 'next/server';

/** Thrown by handlers/helpers to short-circuit with a specific status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = (message = 'Missing or invalid session token') =>
  new ApiError(401, message);
export const forbidden = (message = 'Not yours') => new ApiError(403, message);
export const notFound = (message = 'Not found') => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Wraps a route handler so thrown `ApiError`s become clean JSON responses and
 * anything else becomes a 500 without leaking internals to the caller.
 */
export function handler<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message }, err.status);
      }
      console.error('Unhandled API error', err);
      return json({ error: 'Internal server error' }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest('Request body must be JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  { max = 2000, min = 1 }: { max?: number; min?: number } = {},
): string {
  const value = body[field];
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`"${field}" must not be empty`);
  if (trimmed.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  { max = 2000 }: { max?: number } = {},
): string | null {
  const value = body[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return trimmed || null;
}

export function optionalInt(
  body: Record<string, unknown>,
  field: string,
  { min = 0, max = 100000 }: { min?: number; max?: number } = {},
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badRequest(`"${field}" must be an integer`);
  }
  if (value < min || value > max) {
    throw badRequest(`"${field}" must be between ${min} and ${max}`);
  }
  return value;
}

export function requireTimestamp(body: Record<string, unknown>, field: string): Date {
  const value = body[field];
  if (typeof value !== 'string') throw badRequest(`"${field}" must be an ISO-8601 string`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`"${field}" is not a valid date`);
  return date;
}

/** `?limit=` clamped to a sane window, defaulting to 100. */
export function pageLimit(req: Request, fallback = 100, max = 500): number {
  const raw = new URL(req.url).searchParams.get('limit');
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw badRequest('"limit" must be a positive integer');
  return Math.min(parsed, max);
}
