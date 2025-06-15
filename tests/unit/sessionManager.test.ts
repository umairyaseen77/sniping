import { SessionManager } from '../../src/modules/SessionManager';
import { chromium } from 'playwright';
import { config } from '../../src/config';
import * as encryption from '../../src/utils/encryption';

jest.mock('playwright');
jest.mock('../../src/utils/encryption');
jest.mock('../../src/config', () => ({
  config: {
    session: { filePath: '/test/session.json' },
    amazon: { email: 'test@example.com', pin: '123456' },
    features: { captchaSolving: true, otpRetrieval: true },
    captcha: { apiKey: 'test-key', service: '2captcha' },
  },
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionManager = new SessionManager();
  });

  describe('initialize', () => {
    it('should use existing valid session if available', async () => {
      const mockSession = {
        signInUserSession: {
          accessToken: 'valid-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
          expiresAt: Date.now() + 3600000,
        },
        cookies: [],
        userAgent: 'test-agent',
        timestamp: new Date().toISOString(),
      };

      (encryption.loadAndDecrypt as jest.Mock).mockResolvedValue(mockSession);
      
      // Mock validateSession to return true
      jest.spyOn(sessionManager as any, 'validateSession').mockResolvedValue(true);

      await sessionManager.initialize();

      expect(encryption.loadAndDecrypt).toHaveBeenCalledWith(config.session.filePath);
    });

    it('should perform full login if no valid session exists', async () => {
      (encryption.loadAndDecrypt as jest.Mock).mockResolvedValue(null);
      
      const performFullLoginSpy = jest.spyOn(sessionManager as any, 'performFullLogin')
        .mockResolvedValue(undefined);

      await sessionManager.initialize();

      expect(performFullLoginSpy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle browser launch failures gracefully', async () => {
      (chromium.launch as jest.Mock).mockRejectedValue(new Error('Browser launch failed'));
      
      await expect(sessionManager.initialize()).rejects.toThrow();
    });
  });
}); 