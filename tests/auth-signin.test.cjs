const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/auth.js', 'utf8');
const callbackSource = source.slice(
    source.indexOf('_supabase.auth.onAuthStateChange('),
    source.indexOf('\nfunction updateAuthBadgesAndProviders')
);

function authFixture(fetchProfile) {
    let callback;
    const timers = [];
    const events = [];
    const notices = [];
    const elements = Object.fromEntries(['authSection', 'profileSection'].map(id => [id, { style: {} }]));
    const context = {
        _supabase: { auth: { onAuthStateChange(fn) { callback = fn; } } },
        document: { body: { classList: { toggle() {} } }, getElementById: id => elements[id] },
        window: { dispatchEvent: event => events.push(event), setTabsGuestMode() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        printLog() {}, showLoginBanner() {}, consumePendingOAuthLogin: () => false,
        updateAuthBadgesAndProviders() {}, renderAccountProfileAvatar() {},
        showPopup: (message, type) => notices.push({ message, type }),
        fetchProfile, setTimeout: fn => timers.push(fn), console: { error() {} },
        lastAuthUserId: null, authGeneration: 0, activeProfileAvatarUserId: null, currentProfileAvatar: null
    };
    vm.runInNewContext(callbackSource, context);
    return { callback, timers, events, notices, elements };
}

test('sign-in callback returns immediately before querying Supabase', async () => {
    let release;
    let started = false;
    const profile = new Promise(resolve => { release = resolve; });
    const fixture = authFixture(async () => { started = true; await profile; });
    assert.equal(fixture.callback('SIGNED_IN', { user: { id: 'alice' } }), undefined);
    assert.equal(started, false);
    assert.equal(fixture.elements.authSection.style.display, 'none');
    const task = fixture.timers.shift()();
    assert.equal(started, true);
    assert.equal(fixture.events.at(-1).detail.userId, 'alice');
    release();
    await task;
});

test('profile failure does not block the rest of the signed-in application', async () => {
    const fixture = authFixture(async () => { throw new Error('network failure'); });
    fixture.callback('SIGNED_IN', { user: { id: 'alice' } });
    await fixture.timers.shift()();
    assert.equal(fixture.events.at(-1).detail.userId, 'alice');
    assert.match(fixture.notices[0].message, /Could not load account profile/);
});

test('a late profile load cannot reannounce a signed-out account', async () => {
    let release;
    const fixture = authFixture(() => new Promise(resolve => { release = resolve; }));
    fixture.callback('SIGNED_IN', { user: { id: 'alice' } });
    const task = fixture.timers.shift()();
    fixture.callback('SIGNED_OUT', null);
    release();
    await task;
    assert.deepEqual(fixture.events.filter(event => event.type === 'app-auth-state-changed').map(event => event.detail.userId), ['alice', null]);
});

test('a queued sign-in cannot announce an account after sign-out', async () => {
    let profileStarted = false;
    const fixture = authFixture(async () => { profileStarted = true; });
    fixture.callback('SIGNED_IN', { user: { id: 'alice' } });
    fixture.callback('SIGNED_OUT', null);
    await fixture.timers.shift()();
    assert.equal(profileStarted, false);
    assert.deepEqual(fixture.events.filter(event => event.type === 'app-auth-state-changed').map(event => event.detail.userId), [null]);
});

test('a stale profile query cannot update a different session', async () => {
    const profileSource = source.slice(
        source.indexOf('async function fetchProfile('),
        source.indexOf("\ndocument.getElementById('updateProfileBtn')")
    );
    let resolveQuery;
    const query = new Promise(resolve => { resolveQuery = resolve; });
    const context = {
        lastAuthUserId: 'alice', authGeneration: 1, activeProfileAvatarUserId: null,
        printLog() {},
        _supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => query }) }) }) }
    };
    vm.runInNewContext(profileSource, context);
    const task = context.fetchProfile('alice', 1);
    context.lastAuthUserId = 'bob';
    context.authGeneration = 2;
    resolveQuery({ data: { username: 'Alice' }, error: null });
    await task;
});

test('email sign-in reports returned and rejected errors', async () => {
    const handlerSource = source.slice(
        source.indexOf("document.getElementById('signInBtn').addEventListener"),
        source.indexOf("\ndocument.getElementById('googleSignInBtn')")
    );
    for (const signInWithPassword of [
        async () => ({ error: new Error('Invalid login credentials') }),
        async () => { throw new Error('Network failed'); }
    ]) {
        let handler;
        const notices = [];
        const context = {
            document: { getElementById: id => id === 'signInBtn'
                ? { addEventListener: (_event, fn) => { handler = fn; } }
                : { value: 'test' } },
            _supabase: { auth: { signInWithPassword } },
            printLog() {}, showPopup: (message, type) => notices.push({ message, type }),
            console: { error() {} }
        };
        vm.runInNewContext(handlerSource, context);
        await handler();
        assert.equal(notices.at(-1).type, 'error');
        assert.match(notices.at(-1).message, /Invalid login credentials|Network failed/);
    }
});
