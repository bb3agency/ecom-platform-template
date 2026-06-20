/**
 * Minimal interface required for the restart signal publisher.
 * Accepts a real ioredis instance or any test double that implements these methods.
 *
 * `set` is used to reset the load-shed mode to 'normal' before the restart signal
 * is published, so both containers come back up in normal serving mode.
 */
export type RestartPublisherLike = {
  publish: (channel: string, message: string) => Promise<number>;
  set: (key: string, value: string) => Promise<unknown>;
};

/**
 * Redis pub/sub channel on which the worker publishes a restart signal
 * and both the API process and the worker process subscribe.
 *
 * When the `scheduled-process-restart` BullMQ job fires:
 *   1. The worker publishes to this channel.
 *   2. The API process subscriber calls gracefulShutdown() → fastify.close() → process.exit(0).
 *      Docker `restart: unless-stopped` brings the API container back up with fresh config.
 *   3. The worker process subscriber calls its own shutdown() → process.exit(0).
 *      Docker brings the worker container back up with fresh config.
 *
 * This two-step approach means both containers restart cleanly while in-flight
 * API requests are drained by Fastify before exit, and in-flight BullMQ jobs
 * are allowed to complete (or are re-queued) before the worker exits.
 */
export const SYSTEM_RESTART_CHANNEL = 'system:restart' as const;

export type RestartSignalPayload = {
  /** ID of the BullMQ job that triggered the restart. */
  jobId: string;
  /** ISO-8601 wall-clock time the restart was originally scheduled for. */
  scheduledFor: string;
  /** Ops user ID that requested the restart. */
  requestedBy: string;
};

/**
 * Publishes a restart signal to the SYSTEM_RESTART_CHANNEL.
 *
 * Called by the `scheduled-process-restart` BullMQ job handler immediately
 * before the worker exits. The API process and any other process subscribed
 * to the channel will initiate their own graceful shutdown on receipt.
 *
 * @param publisher - A dedicated ioredis client (not shared with BullMQ).
 * @param payload   - Contextual metadata embedded in the signal message.
 */
export async function publishRestartSignal(
  publisher: RestartPublisherLike,
  payload: RestartSignalPayload
): Promise<void> {
  const message = JSON.stringify(payload);
  await publisher.publish(SYSTEM_RESTART_CHANNEL, message);
}
