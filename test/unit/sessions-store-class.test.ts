import { describe, expect, it } from 'vitest';
import { MAX_STORED_SESSIONS, SessionStore } from '../../src/storage/sessions';
import { FakeStorage, userMessage, assistantMessage, session } from '../helpers/sessionsFixture';

describe('SessionStore', () => {
  it('saves a session and reads it back', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save(session('s1', 10));
    expect(store.get('s1')?.title).toBe('s1');
    expect(store.summaryList()).toHaveLength(1);
  });

  it('saves the history the setting asks for', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    const messages = Array.from({ length: 200 }, (_, index) =>
      index % 2 === 0 ? userMessage('q' + index) : assistantMessage('a' + index)
    );
    await store.save({ ...session('s1', 10), messages }, 200);
    expect(store.get('s1')?.messages).toHaveLength(200);
  });

  it('keeps at most fifty sessions', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    for (let i = 0; i < MAX_STORED_SESSIONS + 10; i++) {
      await store.save(session('s' + i, i));
    }
    expect(store.list()).toHaveLength(MAX_STORED_SESSIONS);
    expect(store.get('s0')).toBeUndefined();
  });

  it('survives a failing state of the host', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    storage.failNextWrite = true;
    const saved = await store.save(session('s1', 10));
    expect(saved).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it('remembers the active session', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    store.setActiveId('s1');
    expect(store.activeId()).toBe('s1');
    store.setActiveId(undefined);
    expect(store.activeId()).toBeUndefined();
  });

  it('tells the project of every chat', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save({ ...session('s1', 10), workspaceRoot: 'C:/projects/alpha' });
    await store.save({ ...session('s2', 20), workspaceRoot: 'C:/projects/beta' });
    const list = store.summaryList();
    const alpha = list.find((item) => item.id === 's1');
    const beta = list.find((item) => item.id === 's2');
    expect(alpha?.workspaceRoot).toBe('C:/projects/alpha');
    expect(alpha?.workspaceLabel).toBe('alpha');
    expect(beta?.workspaceLabel).toBe('beta');
  });

  it('keeps the chats of the projects apart', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save({ ...session('s1', 10), workspaceRoot: 'C:/projects/alpha' });
    await store.save({ ...session('s2', 20), workspaceRoot: 'C:/projects/beta' });
    expect(store.chatsOf('C:/projects/alpha').map((item) => item.id)).toEqual(['s1']);
    expect(store.chatsOf('C:/projects/beta').map((item) => item.id)).toEqual(['s2']);
    expect(store.chatsOf('C:/projects/gamma')).toHaveLength(0);
  });

  it('remembers the open chat of every project', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save({ ...session('s1', 10), workspaceRoot: 'C:/projects/alpha' });
    await store.save({ ...session('s2', 20), workspaceRoot: 'C:/projects/beta' });
    store.setActiveIdFor('C:/projects/alpha', 's1');
    store.setActiveIdFor('C:/projects/beta', 's2');
    expect(store.activeIdFor('C:/projects/alpha')).toBe('s1');
    expect(store.activeIdFor('C:/projects/beta')).toBe('s2');
    // A project without a chat of its own has no open chat.
    expect(store.activeIdFor('C:/projects/gamma')).toBeUndefined();
  });

  it('forgets the open chat of a deleted chat', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save({ ...session('s1', 10), workspaceRoot: 'C:/projects/alpha' });
    store.setActiveIdFor('C:/projects/alpha', 's1');
    store.clearActiveId('s1');
    expect(store.activeIdFor('C:/projects/alpha')).toBeUndefined();
    expect(store.activeId()).toBeUndefined();
  });

  it('takes the chats of an older version into the project that opens them', async () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    await store.save(session('s1', 10));
    // The chat does not know its project, the project that opens it takes it.
    store.claimUnbound('C:/projects/alpha');
    expect(store.get('s1')?.workspaceRoot).toBe('C:/projects/alpha');
    expect(store.chatsOf('C:/projects/alpha')).toHaveLength(1);
    expect(store.chatsOf('C:/projects/beta')).toHaveLength(0);
  });
});
