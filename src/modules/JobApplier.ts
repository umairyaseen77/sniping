import { Worker, Job } from 'bullmq';
import { Page } from 'playwright';
import pLimit from 'p-limit';
import Redis from 'ioredis';
import { config, logger } from '../config';
import { metrics, recordDuration } from '../utils/metrics';
import { traced, addSpanAttributes } from '../utils/tracing';
import { SessionManager } from './SessionManager';
import { DatabaseService } from '../database/DatabaseService';
import { delay } from '../utils/retry';
import { JobData } from '../types';

export class JobApplier {
  private sessionManager: SessionManager;
  private redis: Redis;
  private database: DatabaseService;
  private worker: Worker<JobData> | null = null;
  private concurrencyLimiter: ReturnType<typeof pLimit>;
  private lockKeyPrefix = 'job-sniping:lock:';
  private lockTTL = 3600; // 1 hour

  constructor(sessionManager: SessionManager, redis: Redis, database: DatabaseService) {
    this.sessionManager = sessionManager;
    this.redis = redis;
    this.database = database;
    this.concurrencyLimiter = pLimit(config.worker.concurrency);
  }

  async start(): Promise<void> {
    this.worker = new Worker<JobData>(
      'job-applications',
      async (job) => {
        return this.concurrencyLimiter(() => this.processJob(job));
      },
      {
        connection: this.redis.duplicate(),
        concurrency: config.worker.concurrency,
      }
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, jobData: job.data }, 'Job application completed');
      metrics.applicationsSuccess.inc();
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, jobData: job?.data, error: err }, 'Job application failed');
      metrics.applicationsFailure.labels({ failure_reason: err.message || 'unknown' }).inc();
    });

    logger.info({ concurrency: config.worker.concurrency }, 'Job applier started');
  }

  @traced('JobApplier.processJob')
  private async processJob(job: Job<JobData>): Promise<void> {
    const endTimer = recordDuration(metrics.applicationDuration);
    
    try {
      const jobData = job.data;
      
      // Check if job is already being processed (idempotency)
      const lockKey = `${this.lockKeyPrefix}${jobData.id}`;
      const lockAcquired = await this.redis.set(lockKey, '1', 'EX', this.lockTTL, 'NX');
      
      if (!lockAcquired) {
        logger.warn({ jobId: jobData.id }, 'Job already being processed, skipping');
        return;
      }

      addSpanAttributes({
        'job.id': jobData.id,
        'job.title': jobData.title,
        'job.location': jobData.location,
      });

      metrics.applicationsAttempted.inc();
      metrics.workersActive.labels({ worker_type: 'applier' }).inc();

      try {
        // Update job status to applying
        await this.database.updateJobStatus(jobData.id, 'applying');
        
        // Get authenticated page
        const page = await this.sessionManager.getAuthenticatedPage();
        
        // Apply for the job
        await this.applyForJob(page, jobData);
        
        // Update job status to applied
        await this.database.updateJobStatus(jobData.id, 'applied', {
          appliedAt: new Date(),
        });
        
        logger.info({ jobId: jobData.id }, 'Successfully applied for job');
      } catch (error: any) {
        // Update job status to failed
        await this.database.updateJobStatus(jobData.id, 'failed', {
          reason: error.message,
          failedAt: new Date(),
        });
        throw error;
      } finally {
        metrics.workersActive.labels({ worker_type: 'applier' }).dec();
      }
    } catch (error: any) {
      logger.error({ error, jobData: job.data }, 'Failed to apply for job');
      throw error;
    } finally {
      endTimer();
    }
  }

  private async applyForJob(page: Page, jobData: JobData): Promise<void> {
    try {
      // Navigate to the job application page
      await page.goto(jobData.applicationUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for the apply button to be visible
      const applyButtonSelector = 'button[data-test="apply-button"], a[data-test="apply-button"]';
      await page.waitForSelector(applyButtonSelector, { timeout: 10000 });
      
      // Click the apply button
      await page.click(applyButtonSelector);
      
      // Wait for application form or confirmation
      await page.waitForSelector('[data-test="application-form"], [data-test="application-confirmation"]', {
        timeout: 15000,
      });

      // Check if we need to fill out a form
      const hasForm = await page.$('[data-test="application-form"]');
      
      if (hasForm) {
        await this.fillApplicationForm(page);
      }

      // Submit the application
      const submitButton = await page.waitForSelector(
        'button[type="submit"][data-test="submit-application"], button[data-test="confirm-application"]',
        { timeout: 10000 }
      );
      
      await submitButton.click();

      // Wait for confirmation
      await this.waitForApplicationConfirmation(page);
      
    } catch (error: any) {
      // Take screenshot for debugging
      try {
        const screenshot = await page.screenshot({ fullPage: true });
        logger.error({ 
          error, 
          jobId: jobData.id,
          screenshotSize: screenshot.length 
        }, 'Application failed - screenshot captured');
      } catch (screenshotError) {
        logger.error({ error: screenshotError }, 'Failed to capture screenshot');
      }
      
      throw error;
    }
  }

  private async fillApplicationForm(page: Page): Promise<void> {
    // This is a simplified example - real implementation would need to handle
    // various form fields based on the actual Amazon Jobs application form
    
    // Example: Fill out common fields
    const fields = [
      { selector: 'input[name="phone"]', value: '+1234567890' },
      { selector: 'textarea[name="coverLetter"]', value: 'I am interested in this position.' },
      { selector: 'input[name="availableStartDate"]', value: new Date().toISOString().split('T')[0] },
    ];

    for (const field of fields) {
      const element = await page.$(field.selector);
      if (element) {
        await element.fill(field.value);
        await delay(500); // Small delay between fields
      }
    }

    // Handle checkboxes
    const checkboxes = await page.$$('input[type="checkbox"][required]');
    for (const checkbox of checkboxes) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        await checkbox.check();
      }
    }

    // Handle radio buttons (example: work authorization)
    const workAuthRadio = await page.$('input[type="radio"][name="workAuthorization"][value="yes"]');
    if (workAuthRadio) {
      await workAuthRadio.check();
    }
  }

  private async waitForApplicationConfirmation(page: Page): Promise<void> {
    // Wait for one of several possible confirmation indicators
    const confirmationSelectors = [
      '[data-test="application-complete"]',
      '[data-test="application-success"]',
      'text=Application submitted',
      'text=Thank you for applying',
      'text=Application received',
    ];

    try {
      await page.waitForSelector(confirmationSelectors.join(', '), {
        timeout: 30000,
      });
      
      // Additional validation - check URL or page content
      const url = page.url();
      const pageContent = await page.textContent('body');
      
      if (url.includes('confirmation') || 
          url.includes('success') || 
          pageContent?.toLowerCase().includes('application submitted')) {
        logger.info('Application confirmation detected');
        return;
      }
      
      // If we're here, we might have a false positive
      logger.warn('Confirmation selector found but URL/content validation failed');
      
    } catch (error) {
      throw new Error('Application confirmation not received within timeout');
    }
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
} 