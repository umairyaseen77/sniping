import { JobData } from '../types';

export function renderJobNotificationEmail(job: JobData): { html: string; text: string } {
  const title = `New Job Discovered: ${job.title}`;
  
  const text = `
A new job matching your criteria has been discovered.

Title: ${job.title}
Location: ${job.location}
Posted: ${new Date(job.postedDate).toLocaleDateString()}
URL: ${job.applicationUrl}

The application process has been initiated.
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; }
    .container { padding: 20px; border: 1px solid #ccc; border-radius: 5px; max-width: 600px; }
    .header { font-size: 20px; font-weight: bold; margin-bottom: 20px; }
    .field { margin-bottom: 10px; }
    .label { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">New Job Discovered</div>
    <div class="field"><span class="label">Title:</span> ${job.title}</div>
    <div class="field"><span class="label">Location:</span> ${job.location}</div>
    <div class="field"><span class="label">Posted:</span> ${new Date(job.postedDate).toLocaleDateString()}</div>
    <div class="field"><span class="label">URL:</span> <a href="${job.applicationUrl}">View Job</a></div>
    <hr>
    <p>The automated application process for this job has been queued.</p>
  </div>
</body>
</html>
  `;
  
  return { html, text };
} 