/**
 * Last-resort process error handlers for long-lived entrypoints (worker, API). An unhandled
 * rejection or uncaught exception leaves the process in an undefined state, so we log it and
 * exit non-zero — letting the supervisor (Docker/systemd/etc.) restart a clean process.
 */

/** Minimal structural logger — satisfied by both pino's `Logger` and Fastify's `app.log`. */
interface ErrorLogger {
  error(obj: unknown, msg?: string): void;
}

export const installProcessErrorHandlers = (logger: ErrorLogger): void => {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ reason }, 'Unhandled promise rejection — exiting');
    process.exit(1);
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
};
