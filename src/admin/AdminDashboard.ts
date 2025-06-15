import express, { Router, Request, Response } from 'express';
import { DatabaseService } from '../database/DatabaseService';
import { logger } from '../config';
import { authenticate } from '../middleware/auth';

export class AdminDashboard {
  private router: Router;
  private database: DatabaseService;

  constructor(database: DatabaseService) {
    this.router = express.Router();
    this.database = database;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Admin dashboard home
    this.router.get('/', authenticate, (_req: Request, res: Response) => {
      res.send(this.renderDashboard());
    });

    // Jobs list page
    this.router.get('/jobs', authenticate, async (_req: Request, res: Response) => {
      try {
        const jobs = await this.database.getRecentJobs(100);
        res.send(this.renderJobsList(jobs));
      } catch (error) {
        logger.error({ error }, 'Failed to get jobs');
        res.status(500).send('Failed to load jobs');
      }
    });

    // Job details page
    this.router.get('/jobs/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
      try {
        const job = await this.database.getJobById(req.params.id);
        if (!job) {
          res.status(404).send('Job not found');
          return;
        }
        const auditLogs = await this.database.getAuditLogs('job', job.id);
        res.send(this.renderJobDetails(job, auditLogs));
      } catch (error) {
        logger.error({ error }, 'Failed to get job details');
        res.status(500).send('Failed to load job details');
      }
    });

    // Analytics page
    this.router.get('/analytics', authenticate, async (_req: Request, res: Response) => {
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        
        const [stats, analytics] = await Promise.all([
          this.database.getJobStats(30),
          this.database.getJobAnalytics(startDate, endDate)
        ]);
        
        res.send(this.renderAnalytics(stats, analytics));
      } catch (error) {
        logger.error({ error }, 'Failed to get analytics');
        res.status(500).send('Failed to load analytics');
      }
    });

    // Audit logs page
    this.router.get('/audit', authenticate, async (_req: Request, res: Response) => {
      try {
        const logs = await this.database.getAuditLogs();
        res.send(this.renderAuditLogs(logs));
      } catch (error) {
        logger.error({ error }, 'Failed to get audit logs');
        res.status(500).send('Failed to load audit logs');
      }
    });
  }

  getRouter(): Router {
    return this.router;
  }

  private renderDashboard(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Job Sniping Admin Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        ${this.getStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Job Sniping Admin Dashboard</h1>
            <nav>
                <a href="/admin/">Home</a>
                <a href="/admin/jobs">Jobs</a>
                <a href="/admin/analytics">Analytics</a>
                <a href="/admin/audit">Audit Logs</a>
                <a href="/health">Health Check</a>
                <a href="/metrics">Metrics</a>
            </nav>
        </header>
        
        <main>
            <div class="dashboard-grid">
                <div class="card">
                    <h2>System Status</h2>
                    <div id="system-status">Loading...</div>
                </div>
                
                <div class="card">
                    <h2>Recent Activity</h2>
                    <div id="recent-activity">Loading...</div>
                </div>
                
                <div class="card">
                    <h2>Quick Actions</h2>
                    <button onclick="triggerPoll()">Trigger Manual Poll</button>
                    <button onclick="viewLogs()">View System Logs</button>
                    <button onclick="exportData()">Export Data</button>
                </div>
                
                <div class="card">
                    <h2>Performance Metrics</h2>
                    <div id="performance-metrics">Loading...</div>
                </div>
            </div>
        </main>
    </div>
    
    <script>
        ${this.getScripts()}
    </script>
</body>
</html>
    `;
  }

  private renderJobsList(jobs: any[]): string {
    const jobRows = jobs.map(job => `
        <tr>
            <td><a href="/admin/jobs/${job.id}">${job.id}</a></td>
            <td>${job.title}</td>
            <td>${job.location}</td>
            <td><span class="status status-${job.status}">${job.status}</span></td>
            <td>${new Date(job.createdAt).toLocaleString()}</td>
            <td>${job.appliedAt ? new Date(job.appliedAt).toLocaleString() : '-'}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Jobs - Admin Dashboard</title>
    <style>${this.getStyles()}</style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Jobs Management</h1>
            <nav>
                <a href="/admin/">← Back to Dashboard</a>
            </nav>
        </header>
        
        <main>
            <div class="filters">
                <input type="text" id="search" placeholder="Search jobs..." />
                <select id="status-filter">
                    <option value="">All Statuses</option>
                    <option value="discovered">Discovered</option>
                    <option value="queued">Queued</option>
                    <option value="applying">Applying</option>
                    <option value="applied">Applied</option>
                    <option value="failed">Failed</option>
                </select>
            </div>
            
            <table class="data-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Title</th>
                        <th>Location</th>
                        <th>Status</th>
                        <th>Discovered</th>
                        <th>Applied</th>
                    </tr>
                </thead>
                <tbody>
                    ${jobRows}
                </tbody>
            </table>
        </main>
    </div>
</body>
</html>
    `;
  }

  private renderJobDetails(job: any, auditLogs: any[]): string {
    const auditRows = auditLogs.map(log => `
        <tr>
            <td>${new Date(log.createdAt).toLocaleString()}</td>
            <td>${log.action}</td>
            <td>${JSON.stringify(log.metadata || {})}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Job ${job.id} - Admin Dashboard</title>
    <style>${this.getStyles()}</style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Job Details: ${job.title}</h1>
            <nav>
                <a href="/admin/jobs">← Back to Jobs</a>
            </nav>
        </header>
        
        <main>
            <div class="job-details">
                <div class="card">
                    <h2>Basic Information</h2>
                    <dl>
                        <dt>ID:</dt><dd>${job.id}</dd>
                        <dt>Title:</dt><dd>${job.title}</dd>
                        <dt>Location:</dt><dd>${job.location}</dd>
                        <dt>Type:</dt><dd>${job.jobType}</dd>
                        <dt>Employment:</dt><dd>${job.employmentType}</dd>
                        <dt>Status:</dt><dd><span class="status status-${job.status}">${job.status}</span></dd>
                        <dt>Application URL:</dt><dd><a href="${job.applicationUrl}" target="_blank">View on Amazon</a></dd>
                    </dl>
                </div>
                
                <div class="card">
                    <h2>Timeline</h2>
                    <dl>
                        <dt>Posted:</dt><dd>${new Date(job.postedDate).toLocaleString()}</dd>
                        <dt>Discovered:</dt><dd>${new Date(job.createdAt).toLocaleString()}</dd>
                        <dt>Applied:</dt><dd>${job.appliedAt ? new Date(job.appliedAt).toLocaleString() : 'Not yet'}</dd>
                        ${job.closingDate ? `<dt>Closing:</dt><dd>${new Date(job.closingDate).toLocaleString()}</dd>` : ''}
                    </dl>
                </div>
                
                ${job.failureReason ? `
                <div class="card error">
                    <h2>Failure Details</h2>
                    <p>${job.failureReason}</p>
                </div>
                ` : ''}
                
                <div class="card">
                    <h2>Audit History</h2>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Action</th>
                                <th>Metadata</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${auditRows}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>
</body>
</html>
    `;
  }

  private renderAnalytics(stats: any, analytics: any): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Analytics - Admin Dashboard</title>
    <style>${this.getStyles()}</style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <header>
            <h1>Analytics Dashboard</h1>
            <nav>
                <a href="/admin/">← Back to Dashboard</a>
            </nav>
        </header>
        
        <main>
            <div class="analytics-grid">
                <div class="card">
                    <h2>Job Statistics (Last 30 days)</h2>
                    <div class="stats">
                        <div class="stat">
                            <span class="stat-value">${stats.total}</span>
                            <span class="stat-label">Total Jobs</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${stats.successRate.toFixed(1)}%</span>
                            <span class="stat-label">Success Rate</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${stats.byStatus.applied || 0}</span>
                            <span class="stat-label">Applied</span>
                        </div>
                        <div class="stat">
                            <span class="stat-value">${stats.byStatus.failed || 0}</span>
                            <span class="stat-label">Failed</span>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h2>Jobs by Status</h2>
                    <canvas id="statusChart"></canvas>
                </div>
                
                <div class="card">
                    <h2>Daily Activity</h2>
                    <canvas id="dailyChart"></canvas>
                </div>
                
                <div class="card">
                    <h2>Performance</h2>
                    <p>Average application time: ${(analytics.averageApplicationTime / 60).toFixed(1)} minutes</p>
                </div>
            </div>
        </main>
    </div>
    
    <script>
        // Status Chart
        const statusCtx = document.getElementById('statusChart').getContext('2d');
        new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ${JSON.stringify(Object.keys(stats.byStatus))},
                datasets: [{
                    data: ${JSON.stringify(Object.values(stats.byStatus))},
                    backgroundColor: ['#4CAF50', '#2196F3', '#FF9800', '#F44336', '#9E9E9E']
                }]
            }
        });
        
        // Daily Chart
        const dailyData = ${JSON.stringify(analytics.jobsByDay)};
        const dailyCtx = document.getElementById('dailyChart').getContext('2d');
        new Chart(dailyCtx, {
            type: 'line',
            data: {
                labels: Object.keys(dailyData),
                datasets: [{
                    label: 'Jobs Discovered',
                    data: Object.values(dailyData).map(d => d.discovered || 0),
                    borderColor: '#2196F3',
                    tension: 0.1
                }, {
                    label: 'Jobs Applied',
                    data: Object.values(dailyData).map(d => d.applied || 0),
                    borderColor: '#4CAF50',
                    tension: 0.1
                }]
            }
        });
    </script>
</body>
</html>
    `;
  }

  private renderAuditLogs(logs: any[]): string {
    const logRows = logs.map(log => `
        <tr>
            <td>${new Date(log.createdAt).toLocaleString()}</td>
            <td>${log.action}</td>
            <td>${log.entityType}</td>
            <td><a href="/admin/jobs/${log.entityId}">${log.entityId}</a></td>
            <td>${log.userEmail || '-'}</td>
            <td>${JSON.stringify(log.metadata || {})}</td>
        </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Audit Logs - Admin Dashboard</title>
    <style>${this.getStyles()}</style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Audit Logs</h1>
            <nav>
                <a href="/admin/">← Back to Dashboard</a>
            </nav>
        </header>
        
        <main>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>Entity Type</th>
                        <th>Entity ID</th>
                        <th>User</th>
                        <th>Metadata</th>
                    </tr>
                </thead>
                <tbody>
                    ${logRows}
                </tbody>
            </table>
        </main>
    </div>
</body>
</html>
    `;
  }

  private getStyles(): string {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        header h1 {
            margin-bottom: 10px;
            color: #232f3e;
        }
        
        nav a {
            margin-right: 20px;
            color: #ff9900;
            text-decoration: none;
            font-weight: 500;
        }
        
        nav a:hover {
            text-decoration: underline;
        }
        
        .dashboard-grid, .analytics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        
        .card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .card h2 {
            margin-bottom: 15px;
            color: #232f3e;
        }
        
        .card.error {
            border-left: 4px solid #f44336;
        }
        
        button {
            background: #ff9900;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-right: 10px;
            margin-bottom: 10px;
        }
        
        button:hover {
            background: #ec7211;
        }
        
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        
        .data-table th,
        .data-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        .data-table th {
            background: #f8f8f8;
            font-weight: 600;
        }
        
        .data-table tr:hover {
            background: #f5f5f5;
        }
        
        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
        }
        
        .status-discovered { background: #e3f2fd; color: #1976d2; }
        .status-queued { background: #fff3e0; color: #f57c00; }
        .status-applying { background: #f3e5f5; color: #7b1fa2; }
        .status-applied { background: #e8f5e9; color: #388e3c; }
        .status-failed { background: #ffebee; color: #c62828; }
        
        .filters {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
        }
        
        .filters input,
        .filters select {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        
        .stat {
            text-align: center;
            padding: 15px;
            background: #f8f8f8;
            border-radius: 4px;
        }
        
        .stat-value {
            display: block;
            font-size: 24px;
            font-weight: 600;
            color: #232f3e;
        }
        
        .stat-label {
            display: block;
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        
        dl {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 10px;
        }
        
        dt {
            font-weight: 600;
            color: #666;
        }
        
        dd {
            color: #333;
        }
        
        a {
            color: #ff9900;
            text-decoration: none;
        }
        
        a:hover {
            text-decoration: underline;
        }
    `;
  }

  private getScripts(): string {
    return `
        async function loadSystemStatus() {
            try {
                const response = await fetch('/admin/stats', {
                    headers: {
                        'Authorization': 'Bearer ' + localStorage.getItem('token')
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('system-status').innerHTML = 
                        '<p>Uptime: ' + formatUptime(data.uptime) + '</p>' +
                        '<p>Memory: ' + formatMemory(data.memory.heapUsed) + '</p>' +
                        '<p>Redis: ' + data.redis.version + '</p>';
                } else {
                    document.getElementById('system-status').innerHTML = '<p>Failed to load status</p>';
                }
            } catch (error) {
                console.error('Failed to load system status:', error);
            }
        }
        
        async function triggerPoll() {
            if (confirm('Trigger a manual poll cycle?')) {
                try {
                    const response = await fetch('/admin/trigger-poll', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + localStorage.getItem('token')
                        }
                    });
                    
                    if (response.ok) {
                        alert('Poll triggered successfully');
                    } else {
                        alert('Failed to trigger poll');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }
        }
        
        function viewLogs() {
            window.open('/admin/audit', '_blank');
        }
        
        function exportData() {
            alert('Export functionality coming soon');
        }
        
        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return days + 'd ' + hours + 'h ' + minutes + 'm';
        }
        
        function formatMemory(bytes) {
            return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        }
        
        // Load data on page load
        window.addEventListener('DOMContentLoaded', () => {
            loadSystemStatus();
            setInterval(loadSystemStatus, 10000); // Refresh every 10 seconds
        });
    `;
  }
} 