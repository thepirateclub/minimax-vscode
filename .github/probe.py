import json, os, urllib.request, urllib.parse, base64

AUD = 'marketplace.visualstudio.com'
REQ = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
RT = os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
PUBLISHER = 'katagarov'

def get_token():
    url = REQ + '&audience=' + AUD
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + RT, 'Accept': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.load(r)['value']

def claims(tok):
    p = tok.split('.')[1]
    p += '=' * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))

def exchange(tok):
    body = json.dumps({'publisherName': PUBLISHER}).encode()
    req = urllib.request.Request(
        'https://marketplace.visualstudio.com/_apis/gallery/token?api-version=7.2-preview.1',
        data=body, method='POST',
        headers={'Accept': 'application/json', 'Authorization': 'FederatedToken ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'vsce'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

tok = get_token()
c = claims(tok)
for k in ['sub', 'aud', 'iss', 'job_workflow_ref', 'workflow_ref', 'ref', 'repository', 'repository_id', 'repository_owner', 'repository_owner_id', 'environment', 'actor', 'event_name']:
    print('  claim', k, '=', c.get(k))
code, body = exchange(tok)
print('exchange status =', code)
print('body =', body)