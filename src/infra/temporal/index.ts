/**
 * Temporal connections built from `AppConfig`. The worker uses a `NativeConnection`; clients
 * (CLI, HTTP API) use a `Connection` + `Client`. When `temporalApiKey` is set (Temporal
 * Cloud), TLS + API-key auth are enabled — otherwise it's a plain local dev-server connection.
 * Dev → Cloud is therefore a config change, not a code change.
 */

import { Client, Connection, type ConnectionOptions } from '@temporalio/client';
import { NativeConnection, type NativeConnectionOptions } from '@temporalio/worker';

import type { AppConfig } from '../config';

const connectionOptions = (config: AppConfig): ConnectionOptions & NativeConnectionOptions =>
  config.temporalApiKey === undefined
    ? { address: config.temporalAddress }
    : { address: config.temporalAddress, tls: true, apiKey: config.temporalApiKey };

/** Worker-side connection (used by the Temporal worker). Caller is responsible for closing it. */
export const createWorkerConnection = (config: AppConfig): Promise<NativeConnection> =>
  NativeConnection.connect(connectionOptions(config));

/** Client-side connection + client (used by the CLI and HTTP API). */
export const createClient = async (
  config: AppConfig,
): Promise<{ client: Client; connection: Connection }> => {
  const connection = await Connection.connect(connectionOptions(config));
  const client = new Client({ connection, namespace: config.temporalNamespace });
  return { client, connection };
};
