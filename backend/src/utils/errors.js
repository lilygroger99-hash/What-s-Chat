export class AppError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code = 'bad_request', msg) => new AppError(400, code, msg);
export const unauthorized = (code = 'unauthorized', msg) => new AppError(401, code, msg);
export const forbidden = (code = 'forbidden', msg) => new AppError(403, code, msg);
export const notFound = (code = 'not_found', msg) => new AppError(404, code, msg);
export const tooMany = (code = 'rate_limited', msg) => new AppError(429, code, msg);
