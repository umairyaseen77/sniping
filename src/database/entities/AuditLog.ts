import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('audit_logs')
@Index(['action', 'createdAt'])
@Index(['userId'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  action!: string;

  @Column({ nullable: true })
  userId?: string;

  @Column({ nullable: true })
  userEmail?: string;

  @Column()
  entityType!: string;

  @Column()
  entityId!: string;

  @Column('jsonb', { nullable: true })
  oldValue?: any;

  @Column('jsonb', { nullable: true })
  newValue?: any;

  @Column('jsonb', { nullable: true })
  metadata?: any;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @CreateDateColumn()
  createdAt!: Date;
} 