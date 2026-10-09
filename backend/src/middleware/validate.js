import { badRequest } from '../utils/errors.js';

/** validate(schema, 'body' | 'query' | 'params') — replaces the input with the parsed value. */
export const validate =
  (schema, where = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[where]);
    if (!result.success) {
      const issue = result.error.issues[0];
      return next(badRequest('validation_failed', `${issue.path.join('.') || where}: ${issue.message}`));
    }
    // Express 5 makes req.query a getter; stash parsed values separately.
    req.valid = { ...(req.valid ?? {}), [where]: result.data };
    next();
  };
