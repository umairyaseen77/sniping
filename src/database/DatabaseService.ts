import { DataSource, Repository } from 'typeorm';
import { logger } from '../config';
import { Job } from './entities/Job';
import { AuditLog } from './entities/AuditLog';

export class DatabaseService {
  private dataSource: DataSource;
  private jobRepository!: Repository<Job>;
  private auditRepository!: Repository<AuditLog>;
  private isInitialized = false;

  constructor() {
    this.dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'job_sniping',
      entities: [Job, AuditLog],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV === 'development',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.dataSource.initialize();
      this.jobRepository = this.dataSource.getRepository(Job);
      this.auditRepository = this.dataSource.getRepository(AuditLog);
      this.isInitialized = true;
      logger.info('Database connection established');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to database');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.isInitialized) {
      await this.dataSource.destroy();
      this.isInitialized = false;
      logger.info('Database connection closed');
    }
  }

  // Job operations
  async saveJob(jobData: Partial<Job>): Promise<Job> {
    const job = this.jobRepository.create(jobData);
    const saved = await this.jobRepository.save(job);
    await this.createAuditLog('job_created', 'job', saved.id, null, saved);
    return saved;
  }

  async updateJobStatus(
    jobId: string, 
    status: string, 
    metadata?: any
  ): Promise<Job | null> {
    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job) return null;

    const oldValue = { ...job };
    job.status = status;
    job.updatedAt = new Date();
    
    if (status === 'applied') {
      job.appliedAt = new Date();
    } else if (status === 'failed' && metadata?.reason) {
      job.failureReason = metadata.reason;
    }

    if (metadata) {
      job.metadata = { ...job.metadata, ...metadata };
    }

    const updated = await this.jobRepository.save(job);
    await this.createAuditLog('job_status_updated', 'job', job.id, oldValue, updated);
    
    return updated;
  }

  async getJobById(id: string): Promise<Job | null> {
    return this.jobRepository.findOne({ where: { id } });
  }

  async getJobStats(days: number = 7): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const stats = await this.jobRepository
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('job.createdAt >= :since', { since })
      .groupBy('job.status')
      .getRawMany();

    const totalJobs = await this.jobRepository.count({
      where: { createdAt: since },
    });

    return {
      total: totalJobs,
      byStatus: stats.reduce((acc, { status, count }) => {
        acc[status] = parseInt(count);
        return acc;
      }, {} as Record<string, number>),
      successRate: this.calculateSuccessRate(stats),
    };
  }

  async getRecentJobs(limit: number = 50): Promise<Job[]> {
    return this.jobRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async jobExists(jobId: string): Promise<boolean> {
    const count = await this.jobRepository.count({ where: { id: jobId } });
    return count > 0;
  }

  // Audit operations
  async createAuditLog(
    action: string,
    entityType: string,
    entityId: string,
    oldValue?: any,
    newValue?: any,
    metadata?: any
  ): Promise<void> {
    try {
      const audit = this.auditRepository.create({
        action,
        entityType,
        entityId,
        oldValue,
        newValue,
        metadata,
        userEmail: metadata?.userEmail,
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
      });

      await this.auditRepository.save(audit);
    } catch (error) {
      logger.error({ error, action, entityType, entityId }, 'Failed to create audit log');
    }
  }

  async getAuditLogs(
    entityType?: string,
    entityId?: string,
    limit: number = 100
  ): Promise<AuditLog[]> {
    const query = this.auditRepository.createQueryBuilder('audit');

    if (entityType) {
      query.andWhere('audit.entityType = :entityType', { entityType });
    }

    if (entityId) {
      query.andWhere('audit.entityId = :entityId', { entityId });
    }

    return query
      .orderBy('audit.createdAt', 'DESC')
      .limit(limit)
      .getMany();
  }

  // Analytics
  async getJobAnalytics(startDate: Date, endDate: Date): Promise<any> {
    const jobsByDay = await this.jobRepository
      .createQueryBuilder('job')
      .select("DATE_TRUNC('day', job.createdAt)", 'day')
      .addSelect('COUNT(*)', 'count')
      .addSelect('job.status', 'status')
      .where('job.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .groupBy("DATE_TRUNC('day', job.createdAt)")
      .addGroupBy('job.status')
      .getRawMany();

    const avgApplicationTime = await this.jobRepository
      .createQueryBuilder('job')
      .select('AVG(EXTRACT(EPOCH FROM (job.appliedAt - job.createdAt)))', 'avgSeconds')
      .where('job.status = :status', { status: 'applied' })
      .andWhere('job.appliedAt IS NOT NULL')
      .andWhere('job.createdAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    return {
      jobsByDay: this.groupByDay(jobsByDay),
      averageApplicationTime: avgApplicationTime?.avgSeconds || 0,
      period: { startDate, endDate },
    };
  }

  // Helper methods
  private calculateSuccessRate(stats: Array<{ status: string; count: string }>): number {
    const applied = stats.find(s => s.status === 'applied')?.count || '0';
    const total = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
    return total > 0 ? (parseInt(applied) / total) * 100 : 0;
  }

  private groupByDay(data: any[]): Record<string, any> {
    return data.reduce((acc, item) => {
      const day = item.day.toISOString().split('T')[0];
      if (!acc[day]) {
        acc[day] = {};
      }
      acc[day][item.status] = parseInt(item.count);
      return acc;
    }, {});
  }

  // Cleanup operations
  async cleanupOldJobs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.jobRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .andWhere('status IN (:...statuses)', { 
        statuses: ['failed', 'skipped'] 
      })
      .execute();

    await this.createAuditLog(
      'jobs_cleaned_up',
      'system',
      'cleanup',
      null,
      { deletedCount: result.affected, daysToKeep }
    );

    return result.affected || 0;
  }
} 