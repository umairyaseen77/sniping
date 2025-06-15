import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../config';
import { Counter } from 'prom-client';
import { JwtPayload } from '../types';

// Augment Express Request type for JWT user
declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
  }
}

interface AuthConfig {
  jwtSecret: string;
  jwtExpiry: string;
  apiKeys: string[];
}

const authConfig: AuthConfig = {
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  apiKeys: process.env.API_KEYS?.split(',') || [],
};

// Metric for tracking auth failures
const authFailures = new Counter({
  name: 'auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['type', 'endpoint'],
});

// JWT Authentication
export function authenticateJWT(req: Request, res: Response, next: NextFunction): Response | void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    authFailures.labels({ type: 'missing_header', endpoint: req.path }).inc();
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.split(' ')[1]; // Bearer <token>
  
  if (!token) {
    authFailures.labels({ type: 'missing_token', endpoint: req.path }).inc();
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret);
    if (typeof decoded === 'object' && decoded !== null && 'role' in decoded) {
      req.user = decoded as JwtPayload;
      next();
    } else {
      throw new Error('Invalid token payload');
    }
  } catch (error: any) {
    authFailures.labels({ type: 'invalid_token', endpoint: req.path }).inc();
    logger.warn({ error: error.message, path: req.path }, 'JWT authentication failed');
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// API Key Authentication
export function authenticateAPIKey(req: Request, res: Response, next: NextFunction): Response | void {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    authFailures.labels({ type: 'missing_api_key', endpoint: req.path }).inc();
    return res.status(401).json({ error: 'No API key provided' });
  }

  if (!authConfig.apiKeys.includes(apiKey)) {
    authFailures.labels({ type: 'invalid_api_key', endpoint: req.path }).inc();
    logger.warn({ path: req.path, apiKey: apiKey.substring(0, 8) + '...' }, 'Invalid API key');
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
}

// Combined authentication (JWT or API Key)
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const hasJWT = req.headers.authorization;
  const hasAPIKey = req.headers['x-api-key'];
  
  if (hasJWT) {
    return authenticateJWT(req, res, next);
  } else if (hasAPIKey) {
    return authenticateAPIKey(req, res, next);
  } else {
    authFailures.labels({ type: 'no_auth', endpoint: req.path }).inc();
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// Rate limiting middleware
export function rateLimit(windowMs: number = 60000, max: number = 100) {
  const requests = new Map<string, number[]>();
  
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    
    // Get or create request history
    const requestHistory = requests.get(key) || [];
    
    // Filter out old requests
    const recentRequests = requestHistory.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= max) {
      logger.warn({ ip: key, requests: recentRequests.length }, 'Rate limit exceeded');
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }
    
    // Add current request
    recentRequests.push(now);
    requests.set(key, recentRequests);
    
    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance
      for (const [ip, history] of requests.entries()) {
        const recent = history.filter(time => now - time < windowMs);
        if (recent.length === 0) {
          requests.delete(ip);
        } else {
          requests.set(ip, recent);
        }
      }
    }
    
    next();
  };
}

// Generate JWT token
export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, authConfig.jwtSecret, {
    expiresIn: authConfig.jwtExpiry,
  } as jwt.SignOptions);
}

// Admin role check
export function requireAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  if (!req.user || req.user.role !== 'admin') {
    authFailures.labels({ type: 'insufficient_permissions', endpoint: req.path }).inc();
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Service health check bypass
export function allowHealthChecks(req: Request, res: Response, next: NextFunction) {
  const healthEndpoints = ['/livez', '/readyz', '/metrics'];
  
  if (healthEndpoints.includes(req.path)) {
    return next();
  }
  
  return authenticate(req, res, next);
} 