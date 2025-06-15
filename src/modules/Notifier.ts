import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { config, logger } from '../config';
import { metrics, recordDuration } from '../utils/metrics';
import { traced } from '../utils/tracing';
import { renderJobNotificationEmail } from '../utils/templates';
import { JobData } from '../types';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

export class Notifier {
  private redis: Redis;
  private worker: Worker<JobData> | null = null;
  private transporter: nodemailer.Transporter | null = null;

  constructor(redis: Redis) {
    this.redis = redis;
    if (config.notifications.enabled) {
      const transportOptions: SMTPTransport.Options = {
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.password,
        },
      };
      this.transporter = nodemailer.createTransport(transportOptions);
    }
  }

  async start(): Promise<void> {
    if (!config.notifications.enabled) {
      logger.info('Notifications are disabled');
      return;
    }
    
    this.worker = new Worker<JobData>(
      'job-notifications',
      async (job) => this.processNotification(job),
      {
        connection: this.redis.duplicate(),
        concurrency: 2, // Low concurrency for sending emails
      }
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Notification sent');
      metrics.notificationsSent.inc();
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err }, 'Notification failed');
      metrics.notificationsFailure.inc();
    });

    logger.info('Notifier started');
  }

  @traced('Notifier.processNotification')
  private async processNotification(job: Job<JobData>): Promise<void> {
    const endTimer = recordDuration(metrics.notificationDuration);
    
    try {
      if (!this.transporter) {
        throw new Error('Email transporter not initialized');
      }
      
      const data = job.data;
      const { html, text } = renderJobNotificationEmail(data);

      const mailOptions = {
        from: `Job Sniper <${config.smtp.user}>`,
        to: config.notifications.toEmail,
        subject: `New Job Found: ${data.title}`,
        html,
        text,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info({ to: config.notifications.toEmail, jobId: data.id }, 'Notification email sent');
    } catch (error) {
      logger.error({ error, jobData: job.data }, 'Failed to send notification email');
      throw error;
    } finally {
      endTimer();
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
} 