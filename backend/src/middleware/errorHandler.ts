import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import crypto from 'crypto';

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The submitted data failed validation requirements.',
        details: err.flatten().fieldErrors,
        requestId,
      },
    });
    return;
  }

  // Handle Custom AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  // Unhandled internal server errors
  console.error(`[Error] [RequestId: ${requestId}]`, err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal server error occurred.',
      requestId,
    },
  });
}
