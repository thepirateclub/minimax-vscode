import json, os, urllib.request, base64

AUD = 'marketplace.visualstudio.com'
REQ = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
RT = os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
PUBLISHER = 'katagarov'

def get_token(sub=None):
    url = REQ + '&audience=' + AUD
    if sub:
        url += '&sub=' + urllib.parse.quote(sub, safe='')
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
        headers={'Accept': 'application/json', 'Authorization': 'FederatedToken ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

variants = [
    ('A default', None),
    ('B legacy sub branch main', 'repo:thepirateclub/minimax-vscode:ref:refs/heads/main'),
    ('C legacy sub env', 'repo:thepirateclub/minimax-vscode:environment:production'),
    ('D immutable sub branch main', 'repo:thepirateclub@69038132/minimax-vscode@1471923900:ref:refs/heads/main'),
    ('E legacy sub tag', 'repo:thepirateclub/minimax-vscode:ref:refs/tags/v0.42.2'),
]
for name, sub in variants:
    try:
        tok = get_token(sub)
    except Exception as e:
        print(name, 'TOKEN ERROR', e)
        continue
    c = claims(tok)
    print('===', name)
    print('   sub =', c.get('sub'))
    code, body = exchange(tok)
    print('   exchange status =', code)
    print('   body =', body)