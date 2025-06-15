import { config, logger } from './config';
import { initializeTracing, shutdownTracing } from './utils/tracing';
import { Orchestrator } from './modules/Orchestrator';

// Initialize tracing before anything else
initializeTracing();

async function main() {
  try {
    logger.info({
      env: config.env,
      redis: `${config.redis.host}:${config.redis.port}`,
      features: config.features,
    }, 'Starting Job Sniping Pipeline');

    // Create and start orchestrator
    const orchestrator = new Orchestrator();
    await orchestrator.start();

    logger.info('Job Sniping Pipeline started successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to start Job Sniping Pipeline');
    await shutdownTracing();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  logger.error({ error }, 'Uncaught exception');
  await shutdownTracing();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  await shutdownTracing();
  process.exit(1);
});

// Start the application
main(); 