import { chromium, Browser, Page, BrowserContext } from 'playwright';
import Imap = require('imap');
import { config, logger } from '../config';
import { encryptAndSave, loadAndDecrypt } from '../utils/encryption';
import { retryNetworkRequest } from '../utils/retry';
import { metrics } from '../utils/metrics';
import { traced } from '../utils/tracing';
import { withCircuitBreaker } from '../utils/circuitBreaker';
import axios from 'axios';
import * as fs from 'fs/promises';

interface SessionData {
  signInUserSession: {
    accessToken: string;
    refreshToken: string;
    idToken: string;
    expiresAt: number;
  };
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  userAgent: string;
  timestamp: string;
}

interface Identity {
  id: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  locale: string;
  timezone: string;
}

export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentIdentity: Identity | null = null;
  private identityPool: Identity[] = [];

  constructor() {
    this.loadIdentityPool();
  }

  private async loadIdentityPool(): Promise<void> {
    try {
      const poolPath = './config/identity_pool.json';
      const exists = await fs.access(poolPath).then(() => true).catch(() => false);
      
      if (exists) {
        const content = await fs.readFile(poolPath, 'utf8');
        const pool = JSON.parse(content);
        this.identityPool = pool.identities || [];
        logger.info({ count: this.identityPool.length }, 'Loaded identity pool');
      } else {
        // Use default identity if pool doesn't exist
        this.identityPool = [{
          id: 'default',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezone: 'America/New_York'
        }];
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load identity pool');
    }
  }

  private rotateIdentity(): Identity {
    if (this.identityPool.length === 0) {
      throw new Error('No identities available in pool');
    }

    // Simple round-robin rotation
    const index = Math.floor(Math.random() * this.identityPool.length);
    this.currentIdentity = this.identityPool[index];
    
    metrics.identityRotations.inc();
    logger.info({ identityId: this.currentIdentity.id }, 'Rotated to new identity');
    
    return this.currentIdentity;
  }

  @traced('SessionManager.initialize')
  async initialize(): Promise<void> {
    // Try to load existing session first
    const existingSession = await this.loadSession();
    
    if (existingSession && await this.validateSession(existingSession)) {
      logger.info('Using existing valid session');
      return;
    }

    // If no valid session, perform full login
    await this.performFullLogin();
  }

  private async loadSession(): Promise<SessionData | null> {
    try {
      const session = await loadAndDecrypt(config.session.filePath);
      
      if (!session) {
        return null;
      }

      // Check if session is expired
      if (session.signInUserSession.expiresAt < Date.now()) {
        logger.info('Session expired, will attempt refresh');
        
        // Try to refresh the token
        const refreshed = await this.refreshToken(session);
        if (refreshed) {
          await this.saveSession(refreshed);
          return refreshed;
        }
        
        return null;
      }

      return session;
    } catch (error) {
      logger.error({ error }, 'Failed to load session');
      return null;
    }
  }

  private async validateSession(session: SessionData): Promise<boolean> {
    try {
      await this.launchBrowser(session.userAgent);
      
      // Set cookies
      if (this.context && session.cookies) {
        await this.context.addCookies(session.cookies);
      }

      // Navigate to a protected page to verify session
      if (this.page) {
        const response = await this.page.goto('https://www.amazon.jobs/account', {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        // If we're redirected to login page, session is invalid
        if (response?.url().includes('/login') || response?.status() === 401) {
          logger.info('Session validation failed - redirected to login');
          return false;
        }

        logger.info('Session validation successful');
        return true;
      }

      return false;
    } catch (error) {
      logger.error({ error }, 'Session validation error');
      return false;
    }
  }

  private async refreshToken(session: SessionData): Promise<SessionData | null> {
    try {
      metrics.sessionRefreshes.labels({ refresh_type: 'token' }).inc();
      
      const response = await retryNetworkRequest(
        async () => axios.post('https://www.amazon.jobs/api/auth/refresh', {
          refreshToken: session.signInUserSession.refreshToken,
        }, {
          headers: {
            'Authorization': `Bearer ${session.signInUserSession.accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
        {},
        'token-refresh'
      );

      if (response.data.accessToken) {
        const newSession: SessionData = {
          ...session,
          signInUserSession: {
            ...session.signInUserSession,
            accessToken: response.data.accessToken,
            idToken: response.data.idToken || session.signInUserSession.idToken,
            expiresAt: Date.now() + (response.data.expiresIn || 3600) * 1000,
          },
          timestamp: new Date().toISOString(),
        };

        logger.info('Token refresh successful');
        return newSession;
      }

      return null;
    } catch (error) {
      logger.error({ error }, 'Token refresh failed');
      metrics.sessionErrors.labels({ error_type: 'refresh_failed' }).inc();
      return null;
    }
  }

  @traced('SessionManager.performFullLogin')
  private async performFullLogin(): Promise<void> {
    metrics.sessionRefreshes.labels({ refresh_type: 'full_login' }).inc();
    
    const identity = this.rotateIdentity();
    await this.launchBrowser(identity.userAgent);

    if (!this.page) {
      throw new Error('Browser page not initialized');
    }

    try {
      // Navigate to login page
      await this.page.goto('https://www.amazon.jobs/login', {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      // Enter email
      await this.page.fill('input[name="email"]', config.amazon.email);
      await this.page.click('button[type="submit"]');
      
      // Wait for PIN page
      await this.page.waitForSelector('input[name="pin"]', { timeout: 30000 });
      
      // Enter PIN
      await this.page.fill('input[name="pin"]', config.amazon.pin);
      await this.page.click('button[type="submit"]');

      // Handle CAPTCHA if present
      await this.handleCaptchaIfPresent();

      // Handle OTP
      await this.handleOTP();

      // Wait for successful login
      await this.page.waitForURL('https://www.amazon.jobs/account', {
        timeout: 60000,
      });

      // Capture session data
      const sessionData = await this.captureSessionData();
      
      if (sessionData) {
        await this.saveSession(sessionData);
        logger.info('Full login completed successfully');
      } else {
        throw new Error('Failed to capture session data after login');
      }
    } catch (error) {
      logger.error({ error }, 'Full login failed');
      metrics.sessionErrors.labels({ error_type: 'login_failed' }).inc();
      throw error;
    }
  }

  private async handleCaptchaIfPresent(): Promise<void> {
    if (!this.page) return;

    try {
      // Check if CAPTCHA is present
      const captchaFrame = await this.page.$('iframe[src*="captcha"]');
      
      if (!captchaFrame) {
        logger.debug('No CAPTCHA detected');
        return;
      }

      metrics.captchaChallenges.inc();
      const startTime = Date.now();

      if (!config.features.captchaSolving || !config.captcha.apiKey) {
        throw new Error('CAPTCHA solving disabled or API key not configured');
      }

      // Extract CAPTCHA data
      const captchaData = await this.page.evaluate(() => {
        const frame = document.querySelector('iframe[src*="captcha"]');
        if (!frame) return null;
        
        // Extract sitekey and other parameters from frame URL
        const url = new URL(frame.getAttribute('src') || '');
        return {
          sitekey: url.searchParams.get('k'),
          pageUrl: window.location.href,
        };
      });

      if (!captchaData?.sitekey) {
        throw new Error('Failed to extract CAPTCHA sitekey');
      }

      // Send to CAPTCHA solving service
      const solution = await this.solveCaptcha(captchaData.sitekey, captchaData.pageUrl);
      
      // Inject solution
      await this.page.evaluate((token) => {
        // @ts-ignore
        window.grecaptcha?.callback?.(token);
      }, solution);

      // Wait for CAPTCHA to be processed
      await this.page.waitForTimeout(2000);
      
      const duration = (Date.now() - startTime) / 1000;
      metrics.captchaSolveDuration.observe(duration);
      
      logger.info({ duration }, 'CAPTCHA solved successfully');
    } catch (error) {
      logger.error({ error }, 'CAPTCHA handling failed');
      metrics.captchaFailures.inc();
      throw error;
    }
  }

  @withCircuitBreaker('captcha-service', { 
    failureThreshold: 3, 
    resetTimeout: 120000 // 2 minutes 
  })
  private async solveCaptcha(sitekey: string, pageUrl: string): Promise<string> {
    const apiKey = config.captcha.apiKey;
    
    // Example implementation for 2captcha
    if (config.captcha.service === '2captcha') {
      // Submit CAPTCHA
      const submitResponse = await axios.post('http://2captcha.com/in.php', null, {
        params: {
          key: apiKey,
          method: 'userrecaptcha',
          googlekey: sitekey,
          pageurl: pageUrl,
          json: 1,
        },
      });

      if (submitResponse.data.status !== 1) {
        throw new Error(`CAPTCHA submit failed: ${submitResponse.data.error_text}`);
      }

      const captchaId = submitResponse.data.request;

      // Poll for result
      let attempts = 0;
      while (attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const resultResponse = await axios.get('http://2captcha.com/res.php', {
          params: {
            key: apiKey,
            action: 'get',
            id: captchaId,
            json: 1,
          },
        });

        if (resultResponse.data.status === 1) {
          return resultResponse.data.request;
        }

        if (resultResponse.data.error_text !== 'CAPCHA_NOT_READY') {
          throw new Error(`CAPTCHA solve failed: ${resultResponse.data.error_text}`);
        }

        attempts++;
      }

      throw new Error('CAPTCHA solving timeout');
    }

    throw new Error(`Unsupported CAPTCHA service: ${config.captcha.service}`);
  }

  private async handleOTP(): Promise<void> {
    if (!this.page) return;

    try {
      // Wait for OTP input field
      const otpInput = await this.page.waitForSelector('input[name="otp"]', {
        timeout: 10000,
      }).catch(() => null);

      if (!otpInput) {
        logger.debug('No OTP required');
        return;
      }

      if (!config.features.otpRetrieval) {
        throw new Error('OTP retrieval disabled');
      }

      logger.info('OTP required, fetching from email');
      
      // Fetch OTP from email
      const otp = await this.fetchOTPFromEmail();
      
      if (!otp) {
        throw new Error('Failed to fetch OTP from email');
      }

      // Enter OTP
      await this.page.fill('input[name="otp"]', otp);
      await this.page.click('button[type="submit"]');
      
      logger.info('OTP submitted successfully');
    } catch (error) {
      logger.error({ error }, 'OTP handling failed');
      throw error;
    }
  }

  private async fetchOTPFromEmail(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const imapConfig = {
        user: config.imap.user,
        password: config.imap.password,
        host: config.imap.host,
        port: config.imap.port,
        tls: config.imap.tls,
        tlsOptions: { rejectUnauthorized: false },
      };

      const imapClient = new Imap(imapConfig);
      
      imapClient.once('ready', () => {
        imapClient.openBox('INBOX', false, (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Search for recent emails from Amazon
          const searchCriteria = [
            ['FROM', 'amazon.jobs'],
            ['SINCE', new Date(Date.now() - 5 * 60 * 1000)], // Last 5 minutes
          ];

          imapClient.search(searchCriteria, (err, results) => {
            if (err || !results.length) {
              imapClient.end();
              resolve(null);
              return;
            }

            // Fetch the most recent email
            const fetch = imapClient.fetch(results[results.length - 1], {
              bodies: 'TEXT',
              markSeen: true,
            });

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                let buffer = '';
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                stream.on('end', () => {
                  // Extract OTP from email body
                  const otpMatch = buffer.match(/\b(\d{6})\b/);
                  if (otpMatch) {
                    imapClient.end();
                    resolve(otpMatch[1]);
                  }
                });
              });
            });

            fetch.once('error', (err) => {
              imapClient.end();
              reject(err);
            });

            fetch.once('end', () => {
              imapClient.end();
              resolve(null);
            });
          });
        });
      });

      imapClient.once('error', (err: any) => {
        reject(err);
      });

      imapClient.connect();
    });
  }

  private async captureSessionData(): Promise<SessionData | null> {
    if (!this.page || !this.context) return null;

    try {
      // Intercept API response to capture tokens
      const sessionData = await this.page.evaluate(() => {
        const data = localStorage.getItem('signInUserSession');
        return data ? JSON.parse(data) : null;
      });

      if (!sessionData) {
        logger.warn('No session data found in localStorage');
        return null;
      }

      // Get cookies
      const cookies = await this.context.cookies();

      return {
        signInUserSession: {
          accessToken: sessionData.accessToken,
          refreshToken: sessionData.refreshToken,
          idToken: sessionData.idToken,
          expiresAt: Date.now() + (sessionData.expiresIn || 3600) * 1000,
        },
        cookies,
        userAgent: this.currentIdentity?.userAgent || '',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to capture session data');
      return null;
    }
  }

  private async saveSession(session: SessionData): Promise<void> {
    await encryptAndSave(session, config.session.filePath);
    logger.info('Session saved successfully');
  }

  private async launchBrowser(userAgent?: string): Promise<void> {
    if (this.browser) {
      await this.cleanup();
    }

    const launchOptions: any = {
      headless: config.env === 'production',
      args: ['--disable-blink-features=AutomationControlled'],
    };

    if (config.proxy.url) {
      launchOptions.proxy = {
        server: config.proxy.url,
      };
    }

    this.browser = await chromium.launch(launchOptions);
    
    const contextOptions: any = {
      userAgent: userAgent || this.currentIdentity?.userAgent,
      viewport: this.currentIdentity?.viewport,
      locale: this.currentIdentity?.locale,
      timezoneId: this.currentIdentity?.timezone,
    };

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Add stealth scripts
    await this.page.addInitScript(() => {
      // Override webdriver detection
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
  }

  async getAuthenticatedPage(): Promise<Page> {
    if (!this.page) {
      await this.initialize();
    }
    
    if (!this.page) {
      throw new Error('Failed to get authenticated page');
    }

    return this.page;
  }

  async getSessionTokens(): Promise<{ accessToken: string; idToken: string }> {
    const session = await this.loadSession();
    
    if (!session) {
      throw new Error('No valid session available');
    }

    return {
      accessToken: session.signInUserSession.accessToken,
      idToken: session.signInUserSession.idToken,
    };
  }

  async cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }

    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
} 