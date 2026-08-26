export enum ErrorCode {
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  PROJECT_ALREADY_EXISTS = 'PROJECT_ALREADY_EXISTS',
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_NOT_DIRECTORY = 'PATH_NOT_DIRECTORY',
  PATH_TRAVERSAL_DETECTED = 'PATH_TRAVERSAL_DETECTED',
  PROCESS_SPAWN_FAILED = 'PROCESS_SPAWN_FAILED',
  PORT_IN_USE = 'PORT_IN_USE',
  CYCLE_DETECTED = 'CYCLE_DETECTED',
  SERVICE_NOT_FOUND = 'SERVICE_NOT_FOUND',
  RUNNER_BUSY = 'RUNNER_BUSY',
  CANCELLED = 'CANCELLED',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, details);
  }
}

export class PathSecurityError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.PATH_TRAVERSAL_DETECTED, message, details);
  }
}
