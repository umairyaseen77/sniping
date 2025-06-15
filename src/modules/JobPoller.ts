import { GraphQLClient } from 'graphql-request';
import Redis from 'ioredis';
import { config, logger } from '../config';
import { metrics, recordDuration } from '../utils/metrics';
import { retryNetworkRequest, PermanentError } from '../utils/retry';
import { traced, addSpanAttributes } from '../utils/tracing';
import { withCircuitBreaker } from '../utils/circuitBreaker';
import { SessionManager } from './SessionManager';
import { DatabaseService } from '../database/DatabaseService';
import * as fs from 'fs/promises';
import { AmazonJob, SearchJobsResponse } from '../types';

export class JobPoller {
  private redis: Redis;
  private database: DatabaseService;
  private graphqlClient: GraphQLClient | null = null;
  private sessionManager: SessionManager;
  private query: string = '';
  private seenJobsKey = 'job-sniping:seen-jobs';
  private newJobsQueue = 'job-sniping:new-jobs';

  constructor(sessionManager: SessionManager, redis: Redis, database: DatabaseService) {
    this.sessionManager = sessionManager;
    this.redis = redis;
    this.database = database;
    this.loadGraphQLQuery();
  }

  private async loadGraphQLQuery(): Promise<void> {
    try {
      this.query = await fs.readFile('./config/query.graphql', 'utf8');
      logger.info('Loaded GraphQL query');
    } catch (error) {
      logger.error({ error }, 'Failed to load GraphQL query');
      throw error;
    }
  }

  private async initializeGraphQLClient(): Promise<void> {
    const { accessToken } = await this.sessionManager.getSessionTokens();
    
    this.graphqlClient = new GraphQLClient(config.graphql.endpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  }

  @traced('JobPoller.poll')
  async poll(): Promise<number> {
    const endTimer = recordDuration(metrics.graphqlDuration, { operation: 'searchJobs' });
    
    try {
      metrics.pollerRuns.labels({ status: 'started' }).inc();
      
      if (!this.graphqlClient) {
        await this.initializeGraphQLClient();
      }

      const jobs = await this.fetchAllJobs();
      const newJobs = await this.filterNewJobs(jobs);
      
      if (newJobs.length > 0) {
        await this.enqueueNewJobs(newJobs);
        metrics.newJobsDiscovered.inc(newJobs.length);
        logger.info({ count: newJobs.length }, 'Discovered new jobs');
      }

      metrics.pollerRuns.labels({ status: 'completed' }).inc();
      addSpanAttributes({ 'jobs.total': jobs.length, 'jobs.new': newJobs.length });
      
      return newJobs.length;
    } catch (error: any) {
      logger.error({ error }, 'Job polling failed');
      metrics.pollerErrors.labels({ error_type: error.name || 'unknown' }).inc();
      
      // Check for GraphQL schema errors
      if (error.response?.errors?.some((e: any) => e.extensions?.code === 'GRAPHQL_VALIDATION_FAILED')) {
        metrics.schemaDriftErrors.inc();
        logger.error('GraphQL schema drift detected - query may need updating');
      }
      
      throw error;
    } finally {
      endTimer();
    }
  }

  private async fetchAllJobs(): Promise<AmazonJob[]> {
    const allJobs: AmazonJob[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.fetchJobsPage(offset, limit);
      
      if (response.searchJobCardsByLocation.jobs.length === 0) {
        break;
      }

      allJobs.push(...response.searchJobCardsByLocation.jobs);
      
      if (response.searchJobCardsByLocation.nextOffset === null ||
          response.searchJobCardsByLocation.jobs.length < limit) {
        hasMore = false;
      } else {
        offset = response.searchJobCardsByLocation.nextOffset;
      }

      // Add small delay to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return allJobs;
  }

  @withCircuitBreaker('amazon-jobs-api', {
    failureThreshold: 5,
    resetTimeout: 60000,
    timeout: 30000
  })
  private async fetchJobsPage(offset: number, limit: number): Promise<SearchJobsResponse> {
    if (!this.graphqlClient) {
      throw new Error('GraphQL client not initialized');
    }

    const variables = {
      location: config.jobSearch.location,
      radius: config.jobSearch.radiusMiles,
      sort: 'recent',
      filters: {
        keywords: config.jobSearch.keywords,
      },
      offset,
      limit,
    };

    return retryNetworkRequest(
      async () => {
        metrics.graphqlRequests.labels({ operation: 'searchJobs', status: 'attempt' }).inc();
        
        try {
          const response = await this.graphqlClient!.request<SearchJobsResponse>(
            this.query,
            variables
          );
          
          metrics.graphqlRequests.labels({ operation: 'searchJobs', status: 'success' }).inc();
          return response;
        } catch (error: any) {
          metrics.graphqlRequests.labels({ operation: 'searchJobs', status: 'error' }).inc();
          
          // Don't retry on authentication errors
          if (error.response?.status === 401) {
            throw new PermanentError('Authentication failed - session may be expired');
          }
          
          throw error;
        }
      },
      {
        retries: 3,
        minTimeout: 2000,
      },
      'fetch-jobs-page'
    );
  }

  private async filterNewJobs(jobs: AmazonJob[]): Promise<AmazonJob[]> {
    const pipeline = this.redis.pipeline();
    
    // Check which jobs are already seen
    jobs.forEach(job => {
      pipeline.sismember(this.seenJobsKey, job.id);
    });

    const results = await pipeline.exec();
    
    if (!results) {
      throw new Error('Redis pipeline execution failed');
    }

    const newJobs: AmazonJob[] = [];
    
    for (let i = 0; i < jobs.length; i++) {
      const [err, isSeen] = results[i];
      
      if (err) {
        throw err;
      }

      if (isSeen === 0) {
        newJobs.push(jobs[i]);
      }
    }

    return newJobs;
  }

  private async enqueueNewJobs(jobs: AmazonJob[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    for (const job of jobs) {
      // Add to seen set
      pipeline.sadd(this.seenJobsKey, job.id);
      
      // Set expiry on seen set (30 days)
      pipeline.expire(this.seenJobsKey, 30 * 24 * 60 * 60);
      
      // Add to new jobs queue
      const jobData = {
        id: job.id,
        title: job.title,
        location: `${job.city}, ${job.state}`,
        postedDate: job.postedDate,
        applicationUrl: job.applicationUrl,
        requisitionId: job.requisitionId,
        schedule: job.schedule,
        compensation: job.compensation,
        timestamp: new Date().toISOString(),
      };
      
      pipeline.lpush(this.newJobsQueue, JSON.stringify(jobData));
      
      // Save to database
      try {
        await this.database.saveJob({
          id: job.id,
          title: job.title,
          requisitionId: job.requisitionId,
          description: job.description,
          location: `${job.city}, ${job.state}`,
          jobType: job.jobType,
          employmentType: job.employmentType,
          schedule: job.schedule,
          compensation: job.compensation,
          applicationUrl: job.applicationUrl,
          postedDate: new Date(job.postedDate),
          status: 'discovered',
        });
      } catch (error) {
        logger.error({ error, jobId: job.id }, 'Failed to save job to database');
        // Continue processing other jobs even if one fails
      }
    }

    await pipeline.exec();
    
    // Update queue depth metric
    const queueLength = await this.redis.llen(this.newJobsQueue);
    metrics.queueDepth.labels({ queue_name: 'new-jobs' }).set(queueLength);
  }

  async cleanup(): Promise<void> {
    // No persistent resources to clean up
    this.graphqlClient = null;
  }
} 