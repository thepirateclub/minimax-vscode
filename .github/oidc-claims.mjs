// The claims of the OIDC token of this job, printed as an annotation of the
// run when the publishing failed. The Trusted Publishing policy of the
// Marketplace matches these claims: the owner, the repository, the workflow
// file and the environment. A new token is requested, so nothing secret of
// the failed step is reused, and the token itself is never printed.

const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!url || !bearer) {
  console.log('::error::The job has no OIDC token: the permission id-token: write is missing.');
  process.exit(0);
}

const response = await fetch(url + '&audience=marketplace.visualstudio.com', {
  headers: { Authorization: 'Bearer ' + bearer, Accept: 'application/json' }
});
const { value } = await response.json();
const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
const keys = [
  'sub',
  'repository',
  'repository_id',
  'repository_owner',
  'repository_owner_id',
  'job_workflow_ref',
  'workflow_ref',
  'ref',
  'environment',
  'event_name'
];
const claims = keys.map((key) => key + '=' + (payload[key] ?? '(none)')).join(' | ');
console.log('::error title=OIDC claims of the publishing job::' + claims);
