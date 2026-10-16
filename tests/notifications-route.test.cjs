const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// One OTD instance (fresh module state) per call, optionally with a stubbed legacy `TD`.
function loadRoute(TD) {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
        ...(TD ? { TD } : {}),
    });
    vm.runInContext(source, context);
    return vm.runInContext('proxyRoutes', context).find(r => r.path === '/1.1/activity/about_me.json');
}

// Legacy shape: columns -> feeds -> feedManager.getPoller(feedKey) -> poller.chirpIndex.
// All pollers here belong to account twitter:42 and feed type `interactions`.
function legacyTD(pollers) {
    const feeds = pollers.map((_, i) => ({ getType: () => 'interactions', getAccountKey: () => 'twitter:42', getKey: () => 'feed' + i }));
    return { controller: {
        columnManager: { getAll: () => ({ col: { getFeeds: () => feeds } }) },
        feedManager: { getPoller: (key) => pollers[Number(key.slice(4))] },
    } };
}
const poller = (...ids) => ({ chirpIndex: Object.fromEntries(ids.map(id => [id, {}])) });

const user = (id) => ({ id_str: id, screen_name: 'user' + id, name: 'User ' + id });
const tweet = (id, userId) => ({ id_str: id, user_id_str: userId, full_text: 'tweet ' + id, entities: {} });
const aggregate = (element, id, sortIndex, userIds, tweetIds) => ({
    entry: { entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element }, content: { notification: { id } } } } },
    template: [id, { template: { aggregateUserActionsV1: { fromUsers: userIds.map(id => ({ user: { id } })), targetObjects: tweetIds.map(id => ({ tweet: { id } })) } } }],
});
const single = (element, id, sortIndex, tweetId) => ({
    entry: { entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element }, content: { tweet: { id: tweetId } } } } },
});
function responseText(items, { tweets = [], users = [], top = 'TOP', bottom = 'BOTTOM' } = {}) {
    return JSON.stringify({
        globalObjects: {
            tweets: Object.fromEntries(tweets.map(t => [t.id_str, t])),
            users: Object.fromEntries(users.map(u => [u.id_str, u])),
            notifications: Object.fromEntries(items.filter(i => i.template).map(i => i.template)),
        },
        timeline: { instructions: [{ addEntries: { entries: [
            ...items.map(i => i.entry),
            { entryId: 'cursor-top-1', content: { operation: { cursor: { value: top } } } },
            { entryId: 'cursor-bottom-1', content: { operation: { cursor: { value: bottom } } } },
        ] } }] },
    });
}
const deliver = (route, text) => Array.from(route.afterRequest({ storage: { user_id: '42' }, responseText: text }));
const summary = (n) => `${n.action}:${n.sources[0].id_str}:${n.targets[0].id_str}@${n.max_position}`;

const fixture = () => responseText([
    aggregate('users_liked_your_tweet', 'n1', 1000, ['7', '8'], ['100']),
    single('user_replied_to_your_tweet', 'n2', 900, '101'),
    single('user_mentioned_you', 'n3', 800, '102'),
    single('user_quoted_your_tweet', 'n4', 700, '103'),
    aggregate('users_followed_you', 'n5', 600, ['9'], []),
], { tweets: [tweet('100', '42'), tweet('101', '7'), tweet('102', '8'), tweet('103', '9')], users: [user('7'), user('8'), user('9'), user('42')] });

const everything = ['favorite:7:100@1000', 'favorite:8:100@999', 'reply:7:101@900', 'mention:8:102@800', 'quote:9:103@700', 'follow:9:9@600'];
const legacyIds = ['favorite_7_100', 'favorite_8_100', 'mention_7_101', 'mention_8_102', 'quoted_tweet_9_103', 'follow_9_9'];

test('without legacy state the route falls back to a session-wide set (delivers once)', () => {
    const route = loadRoute();
    assert.deepEqual(deliver(route, fixture()).map(summary), everything);
    assert.deepEqual(deliver(route, fixture()), []);
});

test('a notification is skipped only when every poller of the account already holds it', () => {
    const holdsAll = poller(...legacyIds);
    const empty = poller();
    const route = loadRoute(legacyTD([holdsAll, empty]));
    // second Notifications column just appeared: its poller has nothing, so the page must go through
    assert.deepEqual(deliver(route, fixture()).map(summary), everything);
    legacyIds.forEach(id => { empty.chirpIndex[id] = {}; });
    assert.deepEqual(deliver(route, fixture()), []);
});

test('only the notifications a poller is missing are delivered', () => {
    const route = loadRoute(legacyTD([poller('favorite_7_100', 'mention_7_101', 'quoted_tweet_9_103', 'follow_9_9')]));
    // positions inside an aggregate are numbered over delivered items only (unchanged behaviour), so 8 gets the top slot here
    assert.deepEqual(deliver(route, fixture()).map(summary), ['favorite:8:100@1000', 'mention:8:102@800']);
});

test('ids match what legacy builds: reply -> mention, quote -> quoted_tweet, follow -> follow_<user>_<user>', () => {
    // If any id were spelled differently from legacy's generateInternalID, that item would leak through here.
    const route = loadRoute(legacyTD([poller(...legacyIds)]));
    assert.deepEqual(deliver(route, fixture()), []);
});

test('since polls re-read the top page, and that page does not move the bottom cursor', () => {
    const route = loadRoute();
    const prepare = (query, actAs = '42') => {
        const xhr = {
            modUrl: 'https://api.x.com/1.1/activity/about_me.json?' + query,
            modReqHeaders: { 'x-act-as-user-id': actAs }, storage: {},
            open(method, url) { this.opened = url; },
        };
        route.beforeRequest(xhr);
        route.beforeSend(xhr);
        return xhr;
    };
    assert.ok(!prepare('count=20').modUrl.includes('cursor='));
    route.afterRequest({ storage: { user_id: '42' }, responseText: responseText([], { bottom: 'PAGE1' }) });
    assert.ok(prepare('count=20&max_id=5').modUrl.endsWith('&cursor=PAGE1'));
    route.afterRequest({ storage: { user_id: '42', max_id: '5' }, responseText: responseText([], { bottom: 'PAGE2' }) });
    assert.ok(!prepare('count=20&since_id=9').modUrl.includes('cursor='));
    route.afterRequest({ storage: { user_id: '42', since_id: '9' }, responseText: responseText([], { bottom: 'TOP_PAGE' }) });
    assert.ok(prepare('count=20&max_id=5').modUrl.endsWith('&cursor=PAGE2'));
    assert.ok(!prepare('count=20&max_id=5', '43').modUrl.includes('cursor='));
});

test('a mention without its author is skipped and the rest of the page is kept', () => {
    const route = loadRoute();
    const page = responseText([
        single('user_replied_to_your_tweet', 'n2', 900, '101'),
        single('user_mentioned_you', 'n3', 800, '102'),
        single('user_quoted_your_tweet', 'n4', 700, '103'),
    ], {
        tweets: [tweet('101', '7'), tweet('102', '8'), tweet('103', '9', { quoted_status_id_str: '999' })],
        users: [user('7'), user('9')],
    });
    const delivered = deliver(route, page);
    assert.deepEqual(delivered.map(summary), ['reply:7:101@900', 'quote:9:103@700']);
    assert.equal(delivered[1].targets[0].quoted_status, undefined);
});

class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
        this.headers = {}; this.sent = false;
        this.onload = null; this.onloadend = null; this.onerror = null; this.onreadystatechange = null;
    }
    open() { this.readyState = 1; }
    setRequestHeader(name, value) { if (this.readyState !== 1) throw new Error('state must be OPENED'); this.headers[name] = value; }
    send() { if (this.readyState !== 1) throw new Error('state must be OPENED'); this.sent = true; }
    addEventListener() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
}

test('a notification from a muted account is skipped and the rest of the page is kept', () => {
    const route = loadRoute();
    const muted = user('8');
    muted.muting = true;
    const page = responseText([
        single('user_replied_to_your_tweet', 'n2', 900, '101'),
        aggregate('users_liked_your_tweet', 'n1', 1000, ['8'], ['100']),
    ], { tweets: [tweet('101', '7'), tweet('100', '42')], users: [user('7'), muted, user('42')] });
    assert.deepEqual(deliver(route, page).map(summary), ['reply:7:101@900']);
});

test('a challenge solver failure finishes as 503 without sending', async () => {
    const context = vm.createContext({
        localStorage: { twitterAccountID: '42' }, location: { hostname: 'x.com' },
        navigator: { language: 'en-US' }, XMLHttpRequest: FakeXHR,
        console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => { throw new Error('header not found'); },
    });
    context.window = context;
    vm.runInContext(source, context);
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open('GET', 'https://api.x.com/1.1/activity/about_me.json?count=20', true);
    xhr.setRequestHeader('x-act-as-user-id', '42');
    const loaded = {};
    xhr.onload = () => { loaded.status = xhr.status; loaded.text = xhr.responseText; };
    await xhr.send(null);
    assert.equal(xhr.sent, false);
    assert.equal(loaded.status, 503);
    assert.equal(loaded.text, '[]');
});

test('a re-sent notification keeps the position it was first delivered with', () => {
    const route = loadRoute(legacyTD([poller()]));   // a poller that never catches up forces re-sends
    deliver(route, fixture());
    // the like aggregate moved to the top because a third person liked the tweet
    const later = responseText([aggregate('users_liked_your_tweet', 'n1', 2000, ['7', '8', '11'], ['100'])],
        { tweets: [tweet('100', '42')], users: [user('7'), user('8'), user('11'), user('42')] });
    assert.deepEqual(deliver(route, later).map(summary), ['favorite:7:100@1000', 'favorite:8:100@999', 'favorite:11:100@1998']);
});
