import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  },
  removeOnComplete: {
    age: 86400
  },
  removeOnFail: {
    age: 604800
  }
};

export const dlqJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: false,
  removeOnFail: false
};

export type QueueRegistry = {
  orderProcessing: Queue;
  notifications: Queue;
  shipping: Queue;
  inventoryAlerts: Queue;
  refunds: Queue;
  analytics: Queue;
  cartCleanup: Queue;
  outboxDispatch: Queue;
  reconciliation: Queue;
  deadLetter: Queue;
};

export function createQueueRegistry(connection: ConnectionOptions): QueueRegistry {
  return {
    orderProcessing: new Queue('order-processing', { connection, defaultJobOptions }),
    notifications: new Queue('notifications', { connection, defaultJobOptions }),
    shipping: new Queue('shipping', { connection, defaultJobOptions }),
    inventoryAlerts: new Queue('inventory-alerts', { connection, defaultJobOptions }),
    refunds: new Queue('refunds', { connection, defaultJobOptions }),
    analytics: new Queue('analytics', { connection, defaultJobOptions }),
    cartCleanup: new Queue('cart-cleanup', { connection, defaultJobOptions }),
    outboxDispatch: new Queue('outbox-dispatch', { connection, defaultJobOptions }),
    reconciliation: new Queue('reconciliation', { connection, defaultJobOptions }),
    deadLetter: new Queue('dead-letter', { connection, defaultJobOptions: dlqJobOptions })
  };
}

