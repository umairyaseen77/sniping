# Job Sniping Pipeline v2.0

An enterprise-ready automated job discovery and application system for Amazon Jobs portal.

## 🚀 Features

- **24/7 Automated Monitoring**: Continuously monitors Amazon Jobs for new postings
- **Instant Application Submission**: Automatically applies to jobs within seconds of posting
- **Advanced Authentication**: Handles CAPTCHA solving and OTP verification
- **Session Persistence**: Encrypted session storage with automatic refresh
- **Browser Fingerprint Rotation**: Evades detection with identity pooling
- **Production-Ready**: Full observability with metrics, tracing, and structured logging
- **Resilient Architecture**: Retry logic, graceful shutdown, and error recovery

### 🆕 Critical Features Implemented

- **Admin Dashboard**: Web-based UI for monitoring and management
- **Persistent Storage**: PostgreSQL database for job history and analytics
- **Authentication & Security**: JWT-based auth with rate limiting
- **Circuit Breakers**: Automatic failure detection and recovery
- **Comprehensive Testing**: Unit and integration test suites
- **Audit Trails**: Complete audit logging for compliance
- **Analytics**: Real-time metrics and historical analysis
- **Database Migrations**: Version-controlled schema management

## 📋 Architecture Overview

```
┌─────────────────────┐
│   Orchestrator      │ ← Cron Scheduler
├─────────────────────┤
│                     │
│  ┌───────────────┐  │
│  │Session Manager│  │ ← Authentication & Session
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │
│  │  Job Poller   │  │ ← GraphQL API Queries
│  └───────┬───────┘  │
│          │          │
│  ┌───────▼───────┐  │     ┌─────────┐
│  │     Redis     │◄─┼─────┤ BullMQ  │
│  └───────┬───────┘  │     └────┬────┘
│          │          │          │
│  ┌───────▼───────┐  │  ┌──────▼──────┐
│  │ Job Applier   │  │  │  Notifier   │
│  └───────────────┘  │  └─────────────┘
└─────────────────────┘
```

## 🛠 Prerequisites

- Node.js 20+ or Docker
- Redis 7+
- AWS KMS access (for session encryption)
- CAPTCHA solving service account (2Captcha/Anti-Captcha)
- Email account with IMAP access (for OTP)
- SMTP server (for notifications)

## 🔧 Installation

### Local Development

1. **Clone the repository**
```bash
git clone <repository-url>
cd job-sniping-pipeline
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Set up identity pool** (optional)
```bash
cp config/identity_pool.example.json config/identity_pool.json
# Edit with your proxy/identity configurations
```

5. **Start Redis**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

6. **Run the application**
```bash
npm run dev
```

### Docker Deployment

1. **Build and run with Docker Compose**
```bash
docker-compose up -d
```

2. **View logs**
```bash
docker-compose logs -f app
```

3. **Access services**
- Application: http://localhost:3000
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)

## 📝 Configuration

### Essential Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AMAZON_EMAIL` | Amazon Jobs account email | Yes |
| `AMAZON_PIN` | Amazon Jobs account PIN | Yes |
| `AWS_KMS_KEY_ID` | KMS key for session encryption | Yes |
| `REDIS_HOST` | Redis server host | Yes |
| `CAPTCHA_API_KEY` | CAPTCHA solving service API key | Yes |
| `AGREE_TOS` | Must be `true` for production | Yes (prod) |

See `.env.example` for the complete list.

### Job Search Configuration

Edit these variables to customize job search:
- `JOB_SEARCH_LOCATION`: Target location (e.g., "United Kingdom")
- `JOB_SEARCH_KEYWORDS`: Job keywords (e.g., "Warehouse Operative")
- `JOB_SEARCH_RADIUS_MILES`: Search radius in miles

### Polling Schedule

Set `POLLER_CRON_SCHEDULE` using cron syntax:
- `*/5 * * * *` - Every 5 minutes (default)
- `*/2 * * * *` - Every 2 minutes (aggressive)
- `0 */1 * * *` - Every hour

## 📊 Monitoring

### Health Endpoints

- `GET /livez` - Liveness probe
- `GET /readyz` - Readiness probe (checks Redis)
- `GET /metrics` - Prometheus metrics

### Key Metrics

- `poller_runs_total` - Number of polling cycles
- `new_jobs_discovered_total` - New jobs found
- `applications_success_total` - Successful applications
- `captcha_challenges_total` - CAPTCHA encounters
- `queue_depth` - Current queue size

### Grafana Dashboard

Import the dashboard from `grafana-dashboard.json` for visualization.

## 🔐 Security Considerations

1. **Session Encryption**: All session data is encrypted using AWS KMS
2. **Secrets Management**: Never commit `.env` files or `identity_pool.json`
3. **Network Security**: Use VPN/proxy for production deployments
4. **Rate Limiting**: Respect Amazon's rate limits to avoid bans

## 🚨 Troubleshooting

### Common Issues

1. **Session Invalid**
   - Check email/PIN credentials
   - Verify IMAP access for OTP
   - Ensure KMS key permissions

2. **CAPTCHA Failures**
   - Verify CAPTCHA service API key
   - Check account balance
   - Try different CAPTCHA service

3. **No Jobs Found**
   - Verify GraphQL query matches current schema
   - Check search parameters
   - Ensure session is authenticated

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Manual Testing

Trigger a poll manually (dev only):
```bash
curl -X POST http://localhost:3000/trigger-poll
```

## 🚀 Production Deployment

### Kubernetes

See `k8s/` directory for Kubernetes manifests.

### AWS ECS

Use the provided Dockerfile with ECS task definitions.

### Important Notes

1. **Terms of Service**: You must set `AGREE_TOS=true` to acknowledge the risks
2. **Resource Limits**: Set appropriate CPU/memory limits
3. **Persistent Storage**: Mount volume for `/app/data`
4. **Secrets**: Use AWS Secrets Manager or similar

## 📈 Performance Tuning

- **Concurrency**: Adjust `WORKER_CONCURRENCY` based on resources
- **Redis**: Use Redis Cluster for high availability
- **Proxies**: Rotate proxies to avoid rate limits
- **Caching**: KMS data keys are cached for 1 hour

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## ⚖️ Legal Disclaimer

This software is provided for educational purposes only. Users are responsible for:
- Complying with Amazon's Terms of Service
- Respecting rate limits and usage policies
- Obtaining proper authorization
- Understanding the legal implications

## 📄 License

PROPRIETARY - All rights reserved

---

**Note**: This is a sophisticated automation tool. Use responsibly and ethically. 