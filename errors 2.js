/** An error that is safe to show to the user, with an HTTP status. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest   = (message, details) => new ApiError(400, message, details);
export const unauthorized = (message = 'Please log in to continue.') => new ApiError(401, message);
export const forbidden    = (message = 'You do not have access to that.') => new ApiError(403, message);
export const notFound     = (message = 'We could not find that.') => new ApiError(404, message);
export const conflict     = (message) => new ApiError(409, message);
export const unavailable  = (message) => new ApiError(503, message);
