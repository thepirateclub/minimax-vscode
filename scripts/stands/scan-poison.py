# The scan of the state of the extension for the trigger of the freeze.
#
# It reads the database of VS Code in the read only mode and counts the code
# blocks of json that hold a negative number: such a block sent the highlighter
# of the panel into an endless loop before the fix.
#
# It prints the ids and the counts, never the text of the chat.
#
# Run:
#   python scripts/stands\scan-poison.py
import json
import os
import sqlite3

db = (
    os.path.expandvars(r'%APPDATA%')
    + os.sep
    + 'Code'
    + os.sep
    + 'User'
    + os.sep
    + 'globalStorage'
    + os.sep
    + 'state.vscdb'
)

con = sqlite3.connect('file:' + db.replace(os.sep, '/') + '?mode=ro', uri=True)
row = con.execute(
    "select value from ItemTable where key='local.minimax-agent'"
).fetchone()
if row is None:
    print('the extension has no state, nothing to scan')
    raise SystemExit(0)

data = json.loads(row[0])
sessions = data.get('minimax.sessions') or []
print('sessions in the state:', len(sessions))
print('bytes of the state:', len(row[0]))

DIGIT = '0123456789'


def has_negative_number(code):
    """The rule of the lexer before the fix: a number of json starts with a sign."""
    i = 0
    while i < len(code):
        ch = code[i]
        if ch == '"':
            j = i + 1
            while j < len(code):
                if code[j] == chr(92):
                    j += 2
                    continue
                if code[j] == '"' or code[j] == chr(10):
                    break
                j += 1
            i = j + 1
            continue
        if ch == '-' and i + 1 < len(code) and code[i + 1] in DIGIT:
            return True
        i += 1
    return False


def blocks_of(text):
    parts = text.split(chr(96) * 3)
    out = []
    for i in range(1, len(parts), 2):
        chunk = parts[i]
        nl = chunk.find(chr(10))
        info = (chunk if nl == -1 else chunk[:nl]).strip()
        content = '' if nl == -1 else chunk[nl + 1:]
        out.append((info, content))
    return out


total = 0
for session in sessions:
    hits = []
    for message in session.get('uiMessages') or []:
        texts = []
        if message.get('role') == 'assistant' and message.get('text'):
            texts.append(message['text'])
        tool = message.get('tool') or {}
        if isinstance(tool.get('content'), str):
            texts.append(tool['content'])
        for text in texts:
            for info, content in blocks_of(text):
                lang = info.split()[0].lower() if info.split() else ''
                if lang not in ('json', 'jsonc', 'json5'):
                    continue
                if has_negative_number(content):
                    hits.append(message.get('id'))
    total += len(hits)
    print(
        'session',
        session.get('id'),
        'messages',
        len(session.get('uiMessages') or []),
        'poison blocks',
        len(hits),
        ('-> ' + ', '.join(hits)) if hits else ''
    )

print('TOTAL POISON BLOCKS', total)
if total:
    print('these blocks hang the panel of the version 0.15.0 and older')
