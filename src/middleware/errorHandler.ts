import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { HttpError } from '../lib/httpError';
import { logger } from '../lib/logger';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void next;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: error.issues,
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  logger.error({ err: error, requestId: req.requestId }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong',
      ...(env.APP_ENV === 'development' && error instanceof Error
        ? { details: error.message }
        : {}),
    },
  });
}
