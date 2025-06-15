// Generic Job Data used in queues and processing
export interface JobData {
  id: string;
  title: string;
  location: string;
  postedDate: string;
  applicationUrl: string;
  requisitionId: string;
  schedule?: Record<string, unknown>;
  compensation?: Record<string, unknown>;
  timestamp: string;
}

// Data from the Amazon Jobs GraphQL API
export interface AmazonJob {
  id: string;
  title: string;
  jobType: string;
  employmentType: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  address: string;
  description: string;
  postedDate: string;
  requisitionId:string;
  applicationUrl: string;
  distance?: number;
  schedule?: Record<string, unknown>;
  compensation?: Record<string, unknown>;
}

export interface SearchJobsResponse {
  searchJobCardsByLocation: {
    totalCount: number;
    nextOffset: number | null;
    jobs: AmazonJob[];
  };
}

// Payload for JWT
export interface JwtPayload {
  email: string;
  role: 'admin' | 'user';
} 