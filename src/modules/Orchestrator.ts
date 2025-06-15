import * as cron from 'node-cron';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { config, logger } from '../config';
import { register } from '../utils/metrics';
import { authenticate, rateLimit, generateToken } from '../middleware/auth';
import { SessionManager } from './SessionManager';
import { JobPoller } from './JobPoller';
import { JobApplier } from './JobApplier';
import { Notifier } from './Notifier';
import { DatabaseService } from '../database/DatabaseService';
import { AdminDashboard } from '../admin/AdminDashboard';

export class Orchestrator {
  private app: Express;
  private redis: Redis;
  private database: DatabaseService;
  private sessionManager: SessionManager;
  private jobPoller: JobPoller;
  private jobApplier: JobApplier;
  private notifier: Notifier;
  private applicationQueue: Queue;
  private notificationQueue: Queue;
  private cronJob: cron.ScheduledTask | null = null;
  private server: any = null;
  private isShuttingDown = false;
  private adminDashboard: AdminDashboard;

  constructor() {
    this.app = express();
    
    // Security middleware
    this.app.use(helmet());
    this.app.use(express.json());
    this.app.use(rateLimit(60000, 100)); // 100 requests per minute
    
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
    });

    // Initialize database
    this.database = new DatabaseService();

    // Initialize modules
    this.sessionManager = new SessionManager();
    this.jobPoller = new JobPoller(this.sessionManager, this.redis, this.database);
    this.jobApplier = new JobApplier(this.sessionManager, this.redis, this.database);
    this.notifier = new Notifier(this.redis);
    
    // Initialize admin dashboard
    this.adminDashboard = new AdminDashboard(this.database);

    // Initialize queues
    this.applicationQueue = new Queue('job-applications', {
      connection: this.redis.duplicate(),
    });

    this.notificationQueue = new Queue('job-notifications', {
      connection: this.redis.duplicate(),
    });

    this.setupRoutes();
    this.setupGracefulShutdown();
  }

  private setupRoutes(): void {
    // Health check endpoints
    this.app.get('/livez', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'alive' });
    });

    this.app.get('/readyz', async (_req: Request, res: Response) => {
      try {
        // Check Redis connection
        await this.redis.ping();
        res.status(200).json({ status: 'ready' });
      } catch (error) {
        logger.error({ error }, 'Readiness check failed');
        res.status(503).json({ status: 'not ready', error: 'Redis connection failed' });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', async (_req: Request, res: Response) => {
      try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (error) {
        logger.error({ error }, 'Failed to generate metrics');
        res.status(500).end();
      }
    });

    // Admin endpoints (protected)
    this.app.post('/admin/trigger-poll', authenticate, async (_req: Request, res: Response) => {
      try {
        logger.info('Manual poll triggered');
        await this.runPollingCycle();
        res.status(200).json({ status: 'triggered' });
      } catch (error) {
        logger.error({ error }, 'Manual poll failed');
        res.status(500).json({ error: 'Poll failed' });
      }
    });

    // Admin stats endpoint
    this.app.get('/admin/stats', authenticate, async (_req: Request, res: Response) => {
      try {
        const stats = await this.getSystemStats();
        res.json(stats);
      } catch (error) {
        logger.error({ error }, 'Failed to get stats');
        res.status(500).json({ error: 'Failed to get stats' });
      }
    });

    // Admin login endpoint
    this.app.post('/auth/login', async (req: Request, res: Response) => {
      const { email, password } = req.body;
      
      // Simple admin check - in production, use proper user management
      if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        const token = generateToken({ email, role: 'admin' });
        res.json({ token });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    });
    
    // Mount admin dashboard
    this.app.use('/admin', this.adminDashboard.getRouter());
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        return;
      }

      this.isShuttingDown = true;
      logger.info({ signal }, 'Graceful shutdown initiated');

      // Stop accepting new requests
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
        });
      }

      // Stop cron job
      if (this.cronJob) {
        this.cronJob.stop();
        logger.info('Cron job stopped');
      }

      // Stop workers
      await Promise.all([
        this.jobApplier.stop(),
        this.notifier.stop(),
      ]);

      // Clean up resources
      await Promise.all([
        this.sessionManager.cleanup(),
        this.jobPoller.cleanup(),
      ]);

      // Close Redis connections
      await Promise.all([
        this.redis.quit(),
        this.applicationQueue.close(),
        this.notificationQueue.close(),
      ]);

      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Job Sniping Pipeline v2.0');

      // Initialize database
      await this.database.initialize();

      // Initialize session manager
      await this.sessionManager.initialize();

      // Start workers
      await this.jobApplier.start();
      await this.notifier.start();

      // Schedule polling job
      this.cronJob = cron.schedule(config.worker.pollerCronSchedule, async () => {
        try {
          await this.runPollingCycle();
        } catch (error) {
          logger.error({ error }, 'Polling cycle failed');
        }
      });

      this.cronJob.start();
      logger.info({ schedule: config.worker.pollerCronSchedule }, 'Cron job scheduled');

      // Start HTTP server
      this.server = this.app.listen(config.port, () => {
        logger.info({ port: config.port }, 'HTTP server started');
      });

      // Run initial poll
      logger.info('Running initial poll');
      await this.runPollingCycle();

    } catch (error) {
      logger.error({ error }, 'Failed to start orchestrator');
      throw error;
    }
  }

  private async runPollingCycle(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting polling cycle');

    try {
      // Poll for new jobs
      const newJobsCount = await this.jobPoller.poll();

      if (newJobsCount > 0) {
        // Process new jobs from Redis queue
        const newJobsKey = 'job-sniping:new-jobs';
        
        for (let i = 0; i < newJobsCount; i++) {
          const jobData = await this.redis.rpop(newJobsKey);
          
          if (jobData) {
            const job = JSON.parse(jobData);
            
            // Add to application queue
            await this.applicationQueue.add('apply', job, {
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 5000,
              },
            });

            // Add to notification queue
            await this.notificationQueue.add('notify', job, {
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
            });
          }
        }
      }

      const duration = Date.now() - startTime;
      logger.info({ 
        duration, 
        newJobsCount 
      }, 'Polling cycle completed');

    } catch (error) {
      logger.error({ error }, 'Polling cycle error');
      throw error;
    }
  }

  private async getSystemStats(): Promise<any> {
    const [
      queueStats,
      redisInfo,
      pollerStats,
    ] = await Promise.all([
      this.getQueueStats(),
      this.redis.info(),
      this.getPollerStats(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      queues: queueStats,
      redis: this.parseRedisInfo(redisInfo),
      poller: pollerStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  private async getQueueStats() {
    const [appQueue, notifyQueue] = await Promise.all([
      this.applicationQueue.getJobCounts(),
      this.notificationQueue.getJobCounts(),
    ]);

    return {
      applications: appQueue,
      notifications: notifyQueue,
    };
  }

  private async getPollerStats() {
    const seenJobsCount = await this.redis.scard('job-sniping:seen-jobs');
    return {
      seenJobs: seenJobsCount,
      lastPoll: await this.redis.get('job-sniping:last-poll'),
    };
  }

  private parseRedisInfo(info: string): any {
    const lines = info.split('\r\n');
    const parsed: any = {};
    
    lines.forEach(line => {
      if (line && line.includes(':')) {
        const [key, value] = line.split(':');
        if (key && value) {
          parsed[key] = value;
        }
      }
    });

    return {
      version: parsed.redis_version,
      uptime: parsed.uptime_in_seconds,
      connectedClients: parsed.connected_clients,
      usedMemory: parsed.used_memory_human,
    };
  }
} 