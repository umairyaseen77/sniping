.PHONY: help build run test clean docker-build docker-up docker-down install

# Default target
help:
	@echo "Job Sniping Pipeline v2.0 - Available commands:"
	@echo "  make install       - Install dependencies"
	@echo "  make build         - Build TypeScript code"
	@echo "  make run           - Run the application locally"
	@echo "  make test          - Run tests"
	@echo "  make clean         - Clean build artifacts"
	@echo "  make docker-build  - Build Docker image"
	@echo "  make docker-up     - Start services with Docker Compose"
	@echo "  make docker-down   - Stop Docker Compose services"
	@echo "  make logs          - View application logs"

install:
	npm install

build:
	npm run build

run:
	npm run dev

test:
	npm test

clean:
	rm -rf dist/
	rm -rf node_modules/
	rm -rf data/session.json

docker-build:
	docker build -f docker/Dockerfile -t job-sniping-pipeline:latest .

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

logs:
	docker-compose logs -f app

# Development helpers
redis-start:
	docker run -d -p 6379:6379 --name redis-dev redis:7-alpine

redis-stop:
	docker stop redis-dev && docker rm redis-dev

# Database commands
db-migrate:
	@echo "Running database migrations..."
	npm run typeorm migration:run

db-migrate-generate:
	@echo "Generating new migration..."
	npm run typeorm migration:generate -n $(name)

db-seed:
	@echo "Seeding database..."
	npm run db:seed

db-reset:
	@echo "Resetting database..."
	docker-compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS job_sniping; CREATE DATABASE job_sniping;"
	$(MAKE) db-migrate

# Monitoring
grafana:
	@echo "Opening Grafana dashboard..."
	@open http://localhost:3001 || xdg-open http://localhost:3001

prometheus:
	@echo "Opening Prometheus..."
	@open http://localhost:9090 || xdg-open http://localhost:9090

admin:
	@echo "Opening Admin Dashboard..."
	@open http://localhost:3000/admin || xdg-open http://localhost:3000/admin

# Production deployment
deploy-prod:
	docker build -f docker/Dockerfile -t job-sniping-pipeline:prod .
	docker tag job-sniping-pipeline:prod your-registry/job-sniping-pipeline:latest
	docker push your-registry/job-sniping-pipeline:latest 