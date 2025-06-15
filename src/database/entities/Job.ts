import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('jobs')
@Index(['status', 'createdAt'])
@Index(['requisitionId'])
export class Job {
  @PrimaryColumn()
  id!: string;

  @Column()
  title!: string;

  @Column()
  requisitionId!: string;

  @Column('text', { nullable: true })
  description?: string;

  @Column()
  location!: string;

  @Column()
  jobType!: string;

  @Column()
  employmentType!: string;

  @Column('jsonb', { nullable: true })
  schedule?: any;

  @Column('jsonb', { nullable: true })
  compensation?: any;

  @Column()
  applicationUrl!: string;

  @Column({
    type: 'enum',
    enum: ['discovered', 'queued', 'applying', 'applied', 'failed', 'skipped'],
    default: 'discovered'
  })
  status!: string;

  @Column({ nullable: true })
  failureReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  appliedAt?: Date;

  @Column({ type: 'timestamp' })
  postedDate!: Date;

  @Column({ type: 'timestamp', nullable: true })
  closingDate?: Date;

  @Column('jsonb', { nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 