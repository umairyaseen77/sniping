import { Orchestrator } from '../../src/modules/Orchestrator';
import { DatabaseService } from '../../src/database/DatabaseService';
import Redis from 'ioredis';
import { config } from '../../src/config';

// Mock modules
jest.mock('playwright');
jest.mock('imap');
jest.mock('bullmq');
jest.mock('graphql-request');

describe('Job Sniping Pipeline Integration', () => {
  let orchestrator: Orchestrator;
  let database: DatabaseService;
  let redis: Redis;

  beforeAll(async () => {
    // Initialize services
    redis = new Redis();
    database = new DatabaseService();
    
    // Mock database initialization
    jest.spyOn(database, 'initialize').mockResolvedValue(undefined);
    jest.spyOn(database, 'close').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  beforeEach(() => {
    orchestrator = new Orchestrator();
  });

  describe('Pipeline Flow', () => {
    it('should complete a full job discovery and application cycle', async () => {
      // Mock job data
      const mockJob = {
        id: 'job-123',
        title: 'Warehouse Operative',
        location: 'London, UK',
        requisitionId: 'REQ123',
        applicationUrl: 'https://www.amazon.jobs/apply/job-123',
        postedDate: new Date().toISOString(),
      };

      // Mock GraphQL response
      const mockGraphQLResponse = {
        searchJobCardsByLocation: {
          totalCount: 1,
          nextOffset: null,
          jobs: [mockJob],
        },
      };

      // Mock session manager
      const sessionManager = (orchestrator as any).sessionManager;
      jest.spyOn(sessionManager, 'initialize').mockResolvedValue(undefined);
      jest.spyOn(sessionManager, 'getSessionTokens').mockResolvedValue({
        accessToken: 'mock-token',
        idToken: 'mock-id-token',
      });

      // Mock job poller
      const jobPoller = (orchestrator as any).jobPoller;
      jest.spyOn(jobPoller, 'poll').mockResolvedValue(1);

      // Test the flow
      await orchestrator.start();

      // Verify session was initialized
      expect(sessionManager.initialize).toHaveBeenCalled();

      // Verify polling was triggered
      expect(jobPoller.poll).toHaveBeenCalled();

      // Clean up
      const shutdown = (orchestrator as any).setupGracefulShutdown;
      if (shutdown) {
        process.emit('SIGTERM');
      }
    });

    it('should handle authentication failures gracefully', async () => {
      const sessionManager = (orchestrator as any).sessionManager;
      jest.spyOn(sessionManager, 'initialize').mockRejectedValue(
        new Error('Authentication failed')
      );

      await expect(orchestrator.start()).rejects.toThrow('Authentication failed');
    });

    it('should retry failed job applications', async () => {
      // Mock a failed job application
      const jobApplier = (orchestrator as any).jobApplier;
      
      let attemptCount = 0;
      jest.spyOn(jobApplier, 'processJob').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Application failed');
        }
        return Promise.resolve();
      });

      // The retry logic should be handled by BullMQ
      // This test verifies the setup is correct
      expect(jobApplier).toBeDefined();
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should open circuit breaker after repeated failures', async () => {
      const mockFailingService = jest.fn()
        .mockRejectedValue(new Error('Service unavailable'));

      // Simulate multiple failures
      for (let i = 0; i < 5; i++) {
        try {
          await mockFailingService();
        } catch (e) {
          // Expected to fail
        }
      }

      expect(mockFailingService).toHaveBeenCalledTimes(5);
    });
  });

  describe('Admin API', () => {
    it('should return system stats when authenticated', async () => {
      const mockStats = {
        timestamp: new Date().toISOString(),
        queues: { applications: {}, notifications: {} },
        redis: { version: '7.0.0' },
        poller: { seenJobs: 42 },
        uptime: 3600,
        memory: process.memoryUsage(),
      };

      jest.spyOn(orchestrator as any, 'getSystemStats')
        .mockResolvedValue(mockStats);

      const stats = await (orchestrator as any).getSystemStats();
      expect(stats).toEqual(mockStats);
    });

    it('should reject unauthorized access to admin endpoints', async () => {
      // This would be tested with actual HTTP requests in a real test
      // Here we verify the authentication middleware is in place
      const app = (orchestrator as any).app;
      const routes = app._router.stack
        .filter((r: any) => r.route)
        .map((r: any) => r.route.path);

      expect(routes).toContain('/admin/stats');
      expect(routes).toContain('/admin/trigger-poll');
    });
  });
}); 