const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// One OTD instance with a clock the test moves, optionally with a stubbed legacy `TD`.
function load(TD) {
    const clock = { now: 1000000 };
    class FakeDate extends Date {
        static now() { return clock.now; }
    }
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date: FakeDate, setTimeout, Event: class {}, ProgressEvent: class {},
        ...(TD ? { TD } : {}),
    });
    vm.runInContext(source, context);
    const routes = vm.runInContext('proxyRoutes', context);
    return {
        clock,
        notifications: routes.find(r => r.path === '/1.1/activity/about_me.json'),
        mentions: routes.find(r => r.path === '/1.1/statuses/mentions_timeline.json'),
    };
}

// Legacy's feed scheduler: one task per account and feed type. Records what the routes ask of it.
function legacyTD() {
    const calls = [];
    const TD = { controller: {
        feedScheduler: { _getTask: (account, type) => ({ taskId: 'task-' + type, doTask: () => calls.push(`poll ${account} ${type}`) }) },
        scheduler: { restartPeriodicTask: (id) => calls.push(`restart ${id}`) },
    } };
    return { TD, calls };
}

// The raw XHR a route sees between legacy's send() and the network.
function request(route, query, actAs = '42') {
    const listeners = [];
    const xhr = {
        modUrl: `https://api.x.com${route.path}?${query}`,
        modReqHeaders: { 'x-act-as-user-id': actAs }, storage: {},
        status: 0, responseText: '', sent: 0, loaded: 0,
        open(method, url) { this.opened = url; },
        send() { this.sent++; },
        addEventListener(type, fn) { if (type === 'loadend') listeners.push(fn); },
        onload() { this.loaded++; },
        land(status, text = '') { this.status = status; this.responseText = text; listeners.forEach(fn => fn()); },
    };
    route.beforeRequest(xhr);
    route.beforeSend(xhr);
    route.sendHandler(xhr, null);
    return xhr;
}

const user = (id) => ({ id_str: id, screen_name: 'user' + id, name: 'User ' + id });
const tweet = (id, userId) => ({ id_str: id, user_id_str: userId, full_text: 'tweet ' + id, entities: {} });
function page(mentionIds, bottom = 'BOTTOM') {
    return JSON.stringify({
        globalObjects: { tweets: Object.fromEntries(mentionIds.map(id => [id, tweet(id, '7')])), users: { 7: user('7') }, notifications: {} },
        timeline: { instructions: [{ addEntries: { entries: [
            ...mentionIds.map((id, i) => ({ entryId: 'notification-n' + id, sortIndex: String(1000 - i),
                content: { item: { clientEventInfo: { element: 'user_mentioned_you' }, content: { tweet: { id } } } } })),
            { entryId: 'cursor-top-1', content: { operation: { cursor: { value: 'TOP' } } } },
            { entryId: 'cursor-bottom-1', content: { operation: { cursor: { value: bottom } } } },
        ] } }] },
    });
}
const tweetIds = (route, xhr) => Array.from(route.afterRequest(xhr)).map(t => t.id_str);
const mentionIds = (route, xhr) => Array.from(route.afterRequest(xhr)).map(n => n.targets[0].id_str);

test('a Mentions poll made while the Notifications page is in flight gets that page without a request of its own', () => {
    const { notifications, mentions } = load();
    const fromNotifications = request(notifications, 'count=20&since_id=1');
    const fromMentions = request(mentions, 'count=40&since_id=1');
    assert.equal(fromNotifications.sent, 1);
    assert.equal(fromMentions.sent, 0);
    assert.equal(fromMentions.loaded, 0);

    fromNotifications.land(200, page(['101', '102']));
    assert.equal(fromMentions.loaded, 1);
    assert.deepEqual(mentionIds(notifications, fromNotifications), ['101', '102']);
    assert.deepEqual(tweetIds(mentions, fromMentions), ['101', '102']);
});

test('when the page lands the other column type polls at once and restarts its timer', () => {
    const { TD, calls } = legacyTD();
    const { notifications, mentions } = load(TD);
    request(notifications, 'count=20&since_id=1').land(200, page(['101']));
    assert.deepEqual(calls, ['restart task-mentions', 'poll twitter:42 mentions']);

    // that poll is answered from the page that just landed, and does not start another round
    const fromMentions = request(mentions, 'count=40&since_id=1');
    assert.equal(fromMentions.sent, 0);
    assert.deepEqual(tweetIds(mentions, fromMentions), ['101']);
    assert.equal(calls.length, 2);
});

test('the page is shared for a few seconds, then the next top-page poll asks X again', () => {
    const { TD, calls } = legacyTD();
    const { clock, notifications, mentions } = load(TD);
    request(notifications, 'count=20&since_id=1').land(200, page(['101']));
    clock.now += 4000;
    assert.equal(request(notifications, 'count=20&since_id=1').sent, 0);

    clock.now += 2000;
    const fromMentions = request(mentions, 'count=40&since_id=1');
    assert.equal(fromMentions.sent, 1);
    fromMentions.land(200, page(['103', '101']));
    assert.deepEqual(calls.slice(2), ['restart task-interactions', 'poll twitter:42 interactions']);
    const fromNotifications = request(notifications, 'count=20&since_id=1');
    assert.equal(fromNotifications.sent, 0);
    assert.deepEqual(mentionIds(notifications, fromNotifications), ['103', '101']);
});

test('a failed page is not shared: a waiting poll asks X itself and the other column is left alone', () => {
    const { TD, calls } = legacyTD();
    const { notifications, mentions } = load(TD);
    const fromNotifications = request(notifications, 'count=20&since_id=1');
    const fromMentions = request(mentions, 'count=40&since_id=1');
    fromNotifications.land(429);
    assert.equal(fromMentions.sent, 1);
    assert.equal(fromMentions.loaded, 0);
    assert.deepEqual(calls, []);
    assert.equal(request(notifications, 'count=20&since_id=1').sent, 1);
});

test('scrolling down and other accounts do not take the top page', () => {
    const { notifications, mentions } = load();
    const first = request(mentions, 'count=40');
    first.land(200, page(['101'], 'PAGE1'));
    tweetIds(mentions, first);
    // another account polls for itself
    assert.equal(request(notifications, 'count=20&since_id=1', '43').sent, 1);
    // a max_id request follows the column's own bottom cursor
    const older = request(mentions, 'count=40&max_id=100');
    assert.ok(older.opened.endsWith('&cursor=PAGE1'), older.opened);
    assert.equal(older.sent, 1);
});

// The raw XHR under the Proxy, as far as the shared page touches it.
class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
        this.sent = false; this.listeners = []; this.onload = null; this.onloadend = null; this.onreadystatechange = null;
    }
    open() { this.readyState = 1; }
    setRequestHeader() {}
    send() { this.sent = true; }
    addEventListener(type, fn) { if (type === 'loadend') this.listeners.push(fn); }
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
    land(status, text) {
        this.readyState = 4; this.status = status; this.responseText = text;
        if (this.onload) this.onload({});
        this.listeners.forEach(fn => fn());
    }
}

test('through the XHR Proxy, legacy reads the shared page from the request that never went out', async () => {
    const context = vm.createContext({
        localStorage: { twitterAccountID: '42' }, location: { hostname: 'x.com' },
        navigator: { language: 'en-US' }, XMLHttpRequest: FakeXHR,
        console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'transaction-id',
    });
    context.window = context;
    vm.runInContext(source, context);
    const XHR = vm.runInContext('XMLHttpRequest', context);
    // what legacy's onload saw, by route (the Proxy drops properties the raw XHR doesn't have)
    const loaded = {};
    const legacy = (path) => {
        const xhr = new XHR();
        xhr.open('GET', `https://api.x.com${path}?count=20&since_id=1`, true);
        xhr.setRequestHeader('x-act-as-user-id', '42');
        xhr.onload = () => { loaded[path] = { status: xhr.status, body: JSON.parse(xhr.responseText) }; };
        return xhr;
    };
    const fromNotifications = legacy('/1.1/activity/about_me.json');
    const fromMentions = legacy('/1.1/statuses/mentions_timeline.json');
    await fromNotifications.send(null);
    await fromMentions.send(null);
    assert.equal(fromNotifications.sent, true);
    assert.equal(fromMentions.sent, false);

    fromNotifications.land(200, page(['101']));
    assert.deepEqual(loaded['/1.1/activity/about_me.json'].body.map(n => n.targets[0].id_str), ['101']);
    const mentions = loaded['/1.1/statuses/mentions_timeline.json'];
    assert.equal(mentions.status, 200);
    assert.deepEqual(mentions.body.map(t => t.id_str), ['101']);
});
