import { jest } from '@jest/globals';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = 'localhost';
process.env.AWS_KMS_KEY_ID = 'arn:aws:kms:us-east-1:123456789012:key/test';
process.env.AMAZON_EMAIL = 'test@example.com';
process.env.AMAZON_PIN = '123456';
process.env.JWT_SECRET = 'test-secret';
process.env.AGREE_TOS = 'true';

// Global test timeout
jest.setTimeout(30000);

// Mock logger to reduce noise in tests
jest.mock('../src/config', () => ({
  config: {
    env: 'test',
    port: 3000,
    redis: {
      host: 'localhost',
      port: 6379,
      password: '',
      db: 0,
    },
    aws: {
      region: 'us-east-1',
      kmsKeyId: 'test-key',
    },
    amazon: {
      email: 'test@example.com',
      pin: '123456',
    },
    session: {
      filePath: '/tmp/test-session.json',
      rotationEnabled: false,
    },
    features: {
      captchaSolving: false,
      otpRetrieval: false,
      notifications: false,
      metrics: false,
    },
  },
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock external services
jest.mock('ioredis', () => {
  const Redis = jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn(() => Promise.resolve('PONG')),
    set: jest.fn(() => Promise.resolve('OK')),
    get: jest.fn(() => Promise.resolve(null)),
    del: jest.fn(() => Promise.resolve(1)),
    sadd: jest.fn(() => Promise.resolve(1)),
    sismember: jest.fn(() => Promise.resolve(0)),
    scard: jest.fn(() => Promise.resolve(0)),
    pipeline: jest.fn(() => ({
      exec: jest.fn(() => Promise.resolve([])),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
    })),
    duplicate: jest.fn(() => new Redis()),
    info: jest.fn(() => Promise.resolve('redis_version:7.0.0')),
    llen: jest.fn(() => Promise.resolve(0)),
    rpop: jest.fn(() => Promise.resolve(null)),
  }));
  return Redis;
});

// Mock AWS SDK
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn(() => ({
    send: jest.fn(() => Promise.resolve({
      Plaintext: Buffer.from('test-key'),
      CiphertextBlob: Buffer.from('encrypted-test-key'),
    })),
  })),
  GenerateDataKeyCommand: jest.fn(),
  DecryptCommand: jest.fn(),
}));

// Clean up after tests
afterEach(() => {
  jest.clearAllMocks();
}); 