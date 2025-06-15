import * as dotenv from 'dotenv';
import { pino } from 'pino';

// Load environment variables
dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  }),
});

// Validate required environment variables
function validateConfig() {
  const required = [
    'AMAZON_EMAIL',
    'AMAZON_PIN',
    'REDIS_HOST',
    'AWS_KMS_KEY_ID',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate TOS agreement for production
  if (process.env.NODE_ENV === 'production' && process.env.AGREE_TOS !== 'true') {
    throw new Error('You must set AGREE_TOS=true to run in production');
  }
}

// Configuration object
export const config = {
  // Application
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // AWS
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    kmsKeyId: process.env.AWS_KMS_KEY_ID!,
  },

  // Amazon Jobs
  amazon: {
    email: process.env.AMAZON_EMAIL!,
    pin: process.env.AMAZON_PIN!,
  },

  // Email for OTP
  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    user: process.env.IMAP_USER || process.env.AMAZON_EMAIL!,
    password: process.env.IMAP_PASSWORD || '',
    tls: process.env.IMAP_TLS !== 'false',
  },

  // SMTP for notifications
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
  },

  // Notifications
  notifications: {
    enabled: process.env.ENABLE_NOTIFICATIONS !== 'false',
    toEmail: process.env.NOTIFICATION_TO_EMAIL || process.env.AMAZON_EMAIL!,
  },

  // CAPTCHA
  captcha: {
    enabled: process.env.ENABLE_CAPTCHA_SOLVING !== 'false',
    service: process.env.CAPTCHA_SERVICE || '2captcha',
    apiKey: process.env.CAPTCHA_API_KEY || '',
  },

  // Worker
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '3', 10),
    pollerCronSchedule: process.env.POLLER_CRON_SCHEDULE || '*/5 * * * *',
  },

  // Proxy
  proxy: {
    url: process.env.PROXY_URL,
  },

  // OpenTelemetry
  otel: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
    serviceName: process.env.OTEL_SERVICE_NAME || 'job-sniping-pipeline',
    tracesEnabled: process.env.OTEL_TRACES_ENABLED !== 'false',
    metricsEnabled: process.env.OTEL_METRICS_ENABLED !== 'false',
  },

  // Session
  session: {
    filePath: process.env.SESSION_FILE_PATH || './data/session.json',
    rotationEnabled: process.env.SESSION_ROTATION_ENABLED === 'true',
  },

  // GraphQL
  graphql: {
    endpoint: process.env.GRAPHQL_ENDPOINT || 'https://www.amazon.jobs/graphql',
    timeout: parseInt(process.env.GRAPHQL_TIMEOUT || '30000', 10),
  },

  // Job Search
  jobSearch: {
    location: process.env.JOB_SEARCH_LOCATION || 'United Kingdom',
    keywords: process.env.JOB_SEARCH_KEYWORDS || 'Warehouse Operative',
    radiusMiles: parseInt(process.env.JOB_SEARCH_RADIUS_MILES || '25', 10),
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'default-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    name: process.env.DB_NAME || 'job_sniping',
    ssl: process.env.DB_SSL === 'true',
  },

  // Feature flags
  features: {
    captchaSolving: process.env.ENABLE_CAPTCHA_SOLVING !== 'false',
    otpRetrieval: process.env.ENABLE_OTP_RETRIEVAL !== 'false',
    notifications: process.env.ENABLE_NOTIFICATIONS !== 'false',
    metrics: process.env.ENABLE_METRICS !== 'false',
  },
};

// Validate configuration on startup
validateConfig();

export { logger }; 