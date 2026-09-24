/**
 * App-level error handler: maps errors to the consistent `{ error }` envelope + HTTP status.
 * Extracted so both the server and the route tests exercise the same mapping.
 */

import { WorkflowNotFoundError } from '@temporalio/client';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { ErrorCode } from './error-code';

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid request',
          details: error.issues,
        },
      });
    }
    if (error instanceof WorkflowNotFoundError) {
      return reply
        .code(404)
        .send({ error: { code: ErrorCode.NOT_FOUND, message: 'Workflow not found' } });
    }
    request.log.error(error);
    return reply
      .code(500)
      .send({ error: { code: ErrorCode.INTERNAL, message: 'Internal server error' } });
  });
};
