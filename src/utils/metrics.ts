import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { config } from '../config';

// Initialize default metrics collection
if (config.features.metrics) {
  collectDefaultMetrics({ register });
}

// Custom metrics
export const metrics = {
  // Poller metrics
  pollerRuns: new Counter({
    name: 'poller_runs_total',
    help: 'Total number of job poller runs',
    labelNames: ['status'],
  }),
  
  pollerErrors: new Counter({
    name: 'poller_errors_total',
    help: 'Total number of job poller errors',
    labelNames: ['error_type'],
  }),
  
  newJobsDiscovered: new Counter({
    name: 'new_jobs_discovered_total',
    help: 'Total number of new jobs discovered',
  }),
  
  // Application metrics
  applicationsAttempted: new Counter({
    name: 'applications_attempted_total',
    help: 'Total number of job applications attempted',
  }),
  
  applicationsSuccess: new Counter({
    name: 'applications_success_total',
    help: 'Total number of successful job applications',
  }),
  
  applicationsFailure: new Counter({
    name: 'applications_failure_total',
    help: 'Total number of failed job applications',
    labelNames: ['failure_reason'],
  }),
  
  applicationDuration: new Histogram({
    name: 'application_duration_seconds',
    help: 'Duration of job application process',
    buckets: [1, 5, 10, 30, 60, 120, 300],
  }),
  
  // CAPTCHA metrics
  captchaChallenges: new Counter({
    name: 'captcha_challenges_total',
    help: 'Total number of CAPTCHA challenges encountered',
  }),
  
  captchaSuccess: new Counter({
    name: 'captcha_success_total',
    help: 'Total number of successful CAPTCHA solves',
  }),
  
  captchaFailure: new Counter({
    name: 'captcha_failures_total',
    help: 'Total number of CAPTCHA solving failures',
  }),
  
  // OTP metrics
  otpRequests: new Counter({
    name: 'otp_requests_total',
    help: 'Total number of OTP requests',
  }),
  
  otpSuccess: new Counter({
    name: 'otp_success_total',
    help: 'Total number of successful OTP retrievals',
  }),
  
  otpFailure: new Counter({
    name: 'otp_failure_total',
    help: 'Total number of failed OTP retrievals',
  }),
  
  // Session metrics
  sessionRefreshes: new Counter({
    name: 'session_refreshes_total',
    help: 'Total number of session refreshes',
  }),
  
  sessionRefreshFailures: new Counter({
    name: 'session_refresh_failures_total',
    help: 'Total number of session refresh failures',
  }),
  
  // Queue metrics
  queueDepth: new Gauge({
    name: 'queue_depth',
    help: 'Current depth of job processing queue',
    labelNames: ['queue_name'],
  }),
  
  queueProcessingTime: new Histogram({
    name: 'queue_processing_time_seconds',
    help: 'Time taken to process queue items',
    labelNames: ['queue_name'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  }),
  
  // Worker metrics
  workersActive: new Gauge({
    name: 'workers_active',
    help: 'Number of active workers',
    labelNames: ['worker_type'],
  }),
  
  // KMS metrics
  kmsCacheHits: new Counter({
    name: 'kms_cache_hits_total',
    help: 'Total number of KMS cache hits',
  }),
  
  kmsCacheMisses: new Counter({
    name: 'kms_cache_misses_total',
    help: 'Total number of KMS cache misses',
  }),
  
  // GraphQL metrics
  graphqlRequests: new Counter({
    name: 'graphql_requests_total',
    help: 'Total number of GraphQL requests',
    labelNames: ['operation', 'status'],
  }),
  
  graphqlDuration: new Histogram({
    name: 'graphql_duration_seconds',
    help: 'Duration of GraphQL requests',
    labelNames: ['operation'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
  
  schemaDriftErrors: new Counter({
    name: 'schema_drift_errors_total',
    help: 'Total number of GraphQL schema drift errors',
  }),
  
  // Notification metrics
  notificationsSent: new Counter({
    name: 'notifications_sent_total',
    help: 'Total number of notifications sent',
  }),
  
  notificationsFailure: new Counter({
    name: 'notifications_failure_total',
    help: 'Total number of notifications that failed to send',
  }),
  
  notificationDuration: new Histogram({
    name: 'notification_duration_seconds',
    help: 'Duration of sending notifications in seconds',
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  }),
  
  // Identity rotation metrics
  identityRotations: new Counter({
    name: 'identity_rotations_total',
    help: 'Total number of identity rotations',
  }),
};

// Export the registry for use in Express endpoint
export { register };

// Helper function to record duration
export function recordDuration(
  histogram: Histogram<string>,
  labels: Record<string, string> = {}
): () => void {
  const start = Date.now();
  return () => {
    const duration = (Date.now() - start) / 1000;
    histogram.labels(labels).observe(duration);
  };
} 