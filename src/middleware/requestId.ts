import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.header('x-request-id');
  const id = headerId && headerId.trim().length > 0 ? headerId.trim() : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
