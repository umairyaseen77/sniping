import { DataSource } from 'typeorm';
import { config } from './src/config';

export default new DataSource({
  type: 'postgres',
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.name,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  entities: ['src/database/entities/*.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: config.env === 'development',
}); 