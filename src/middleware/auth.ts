import { readFileSync } from 'fs';
import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload, type VerifyOptions } from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../shared/errors';

export type AuthRole = 'admin' | 'staff' | 'customer' | 'system';

export interface AuthClaims extends JwtPayload {
  sub: string;
  email: string;
  role: AuthRole;
  branch_id?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthClaims;
  }
}

// Prefer an inline PEM (production: matches the Go core prod signing key);
// fall back to the mounted/baked key file (local/dev).
const publicKey: string | Buffer =
  config.jwt.publicKeyPem && config.jwt.publicKeyPem.trim()
    ? config.jwt.publicKeyPem.replace(/\\n/g, '\n')
    : readFileSync(config.jwt.publicKeyPath);

const verifyOptions: VerifyOptions = {
  algorithms: ['RS256'],
  issuer: config.jwt.issuer,
  audience: config.jwt.audience,
};

function decodeBearer(req: Request): string | null {
  const header = req.header('authorization') ?? req.header('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Express middleware that requires a valid RS256 Bearer JWT and attaches the
 * decoded claims to `req.auth`. Forwards AppError('UNAUTHORIZED') to next() when
 * the token is missing, invalid, or lacks `sub`/`role`.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = decodeBearer(req);
  if (!token) {
    next(new AppError('UNAUTHORIZED', 'Bearer token is required'));
    return;
  }
  try {
    const decoded = jwt.verify(token, publicKey, verifyOptions) as AuthClaims;
    if (!decoded.sub || !decoded.role) {
      throw new Error('claims missing sub or role');
    }
    req.auth = decoded;
    next();
  } catch (err) {
    next(new AppError('UNAUTHORIZED', (err as Error).message));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = decodeBearer(req);
  if (!token) {
    next();
    return;
  }
  try {
    const decoded = jwt.verify(token, publicKey, verifyOptions) as AuthClaims;
    req.auth = decoded;
  } catch {
    // ignore invalid optional tokens
  }
  next();
}

/**
 * Build an Express middleware that authorizes the request only when `req.auth.role`
 * is one of the allowed `roles` (use after requireAuth).
 * @param roles - the roles permitted to proceed.
 * @returns middleware forwarding UNAUTHORIZED (no auth) or FORBIDDEN (wrong role) to next().
 */
export function requireRoles(...roles: AuthRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError('UNAUTHORIZED', 'authentication required'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new AppError('FORBIDDEN', `role ${req.auth.role} not permitted`));
      return;
    }
    next();
  };
}
