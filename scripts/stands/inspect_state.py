import sqlite3, os, json
db = os.path.expandvars(r'%APPDATA%') + os.sep + 'Code' + os.sep + 'User' + os.sep + 'globalStorage' + os.sep + 'state.vscdb'
con = sqlite3.connect('file:' + db.replace(os.sep,'/') + '?mode=ro', uri=True)
cur = con.cursor()
val = cur.execute("select value from ItemTable where key='local.minimax-agent'").fetchone()[0]
print('total value bytes:', len(val))
data = json.loads(val)
for k, v in data.items():
    print('KEY:', k, 'bytes:', len(json.dumps(v)))
sessions = data.get('minimax.sessions')
if isinstance(sessions, list):
    print('sessions:', len(sessions))
    for s in sessions:
        um = s.get('uiMessages') or []
        print('--- id', s.get('id'), 'root', s.get('workspaceRoot'), 'uiMessages', len(um), 'bytes', len(json.dumps(s)))
        rows = []
        for i, m in enumerate(um):
            t = len(m.get('text') or '')
            th = len(m.get('thinking') or '')
            tool = m.get('tool') or {}
            tc = len(tool.get('content') or '')
            tp = len(tool.get('progress') or [])
            rows.append((t+th+tc, i, m.get('role'), t, th, tc, tp))
        rows.sort(reverse=True)
        for row in rows[:5]:
            print('    idx', row[1], 'role', row[2], 'text', row[3], 'thinking', row[4], 'toolContent', row[5], 'progressLines', row[6])
        hist = s.get('messages') or []
        hsize = len(json.dumps(hist))
        hbig = 0
        for m in hist:
            for b in (m.get('content') or []):
                bl = len(b.get('text') or b.get('thinking') or b.get('content') or '')
                hbig = max(hbig, bl)
        print('    historyMessages', len(hist), 'historyBytes', hsize, 'biggestBlockChars', hbig)
