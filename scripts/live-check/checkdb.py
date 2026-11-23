import json, sqlite3

db = r"C:\Users\StarFallPC\AppData\Roaming\Code\User\globalStorage\state.vscdb"
con = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
row = con.execute("SELECT value FROM ItemTable WHERE key = ?", ('local.minimax-agent',)).fetchone()
blob = json.loads(row[0]) if row else {}
print('blob keys:', sorted(blob.keys()))
sessions = blob.get('minimax.sessions') or []
out = []
for s in sessions:
    msgs = s.get('uiMessages') or []
    out.append({
        'title': (s.get('title') or '')[:44],
        'messages': len(msgs),
        'approvalCards': sum(1 for m in msgs if m.get('approval')),
        'probeRequest': any('cancel-probe' in (m.get('text') or '') for m in msgs),
    })
print(json.dumps(out, ensure_ascii=False, indent=1))
print('active:', (blob.get('minimax.activeSession') or '')[:24])
