import json, os, sqlite3

# The state of the editor lives in the profile of the user, the path comes
# from the system: the script has to run on any machine.
db = os.path.join(
    os.environ.get('APPDATA', ''),
    'Code', 'User', 'globalStorage', 'state.vscdb'
)
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
