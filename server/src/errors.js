export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code   machine-readable code the client switches on
   * @param {string} message human-readable message
   * @param {object} [details] extra payload (e.g. a refreshed cart or a fresh quote)
   */
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (msg) => new AppError(400, 'BAD_REQUEST', msg);
