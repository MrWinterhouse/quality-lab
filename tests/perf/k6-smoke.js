import http from 'k6/http';
import { check } from 'k6';

// Optional: requires k6 (https://k6.io). The dependency-free alternative is `npm run load`.
export const options = {
  vus: 10,
  duration: '15s',
  thresholds: {
    http_req_duration: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:4310';
const headers = { Authorization: 'Bearer tok_applicant_a' };

export default function () {
  const response = http.get(`${baseUrl}/api/programs?state=CA&householdSize=4`, { headers });
  check(response, { 'programs returns 200': (result) => result.status === 200 });
}
