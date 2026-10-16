const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

function loadRoute() {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    return vm.runInContext('proxyRoutes', context).find(r => r.path === '/1.1/statuses/mentions_timeline.json');
}

const legacyRequest = (query) => ({
    modUrl: 'https://api.x.com/1.1/statuses/mentions_timeline.json?' + query,
    modReqHeaders: { 'x-act-as-user-id': '42' }, storage: {},
});
const user = (id) => ({ id_str: id, screen_name: 'user' + id, name: 'User ' + id });
const tweet = (id, userId, extra = {}) => ({ id_str: id, user_id_str: userId, full_text: 'tweet ' + id, entities: {}, ...extra });
const single = (element, id, sortIndex, tweetId) =>
    ({ entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element }, content: { tweet: { id: tweetId } } } } });
const aggregate = (element, id, sortIndex) =>
    ({ entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element }, content: { notification: { id } } } } });
function allJsonPage(entries, { tweets = [], users = [] } = {}) {
    return JSON.stringify({
        globalObjects: { tweets: Object.fromEntries(tweets.map(t => [t.id_str, t])), users: Object.fromEntries(users.map(u => [u.id_str, u])), notifications: {} },
        timeline: { instructions: [{ addEntries: { entries: [
            ...entries,
            { entryId: 'cursor-top-1', content: { operation: { cursor: { value: 'TOP' } } } },
            { entryId: 'cursor-bottom-1', content: { operation: { cursor: { value: 'BOTTOM' } } } },
        ] } }] },
    });
}

test('mentions are read from the all.json notifications timeline, with their own cursors', () => {
    const route = loadRoute();
    const first = legacyRequest('count=40');
    route.beforeRequest(first);
    assert.ok(first.modUrl.startsWith('https://x.com/i/api/2/notifications/all.json?'), first.modUrl);
    assert.ok(!first.modUrl.includes('cursor='), 'initial load carries no cursor');

    route.afterRequest({ storage: { user_id: '42' }, responseText: allJsonPage([]) });

    const newer = legacyRequest('count=40&since_id=5');
    route.beforeRequest(newer);
    assert.ok(newer.modUrl.endsWith('&cursor=TOP'), newer.modUrl);
    const older = legacyRequest('count=40&max_id=5');
    route.beforeRequest(older);
    assert.ok(older.modUrl.endsWith('&cursor=BOTTOM'), older.modUrl);
});

test('only mention, reply and quote entries of the page become tweets', () => {
    const route = loadRoute();
    const page = allJsonPage([
        aggregate('users_liked_your_tweet', 'n1', 1000),
        single('user_replied_to_your_tweet', 'n2', 900, '101'),
        aggregate('users_followed_you', 'n3', 850),
        single('user_mentioned_you', 'n4', 800, '102'),
        single('user_quoted_your_tweet', 'n5', 700, '103'),
        single('user_mentioned_you', 'n6', 600, '999'),   // tweet missing from globalObjects: skipped, not thrown
    ], {
        tweets: [tweet('101', '7'), tweet('102', '8'), tweet('103', '9', { quoted_status_id_str: '100' }), tweet('100', '42')],
        users: [user('7'), user('8'), user('9'), user('42')],
    });
    const tweets = Array.from(route.afterRequest({ storage: { user_id: '42' }, responseText: page }));
    assert.deepEqual(tweets.map(t => t.id_str), ['101', '102', '103']);
    assert.deepEqual(tweets.map(t => t.user.screen_name), ['user7', 'user8', 'user9']);
    assert.equal(tweets[2].quoted_status.id_str, '100');
    assert.equal(tweets[2].quoted_status.user.screen_name, 'user42');
});

test('rate-limit headers are halved for the shared all.json quota and left alone when absent', () => {
    const override = loadRoute().responseHeaderOverride;
    assert.equal(override['x-rate-limit-limit']('180'), 90);
    assert.equal(override['x-rate-limit-remaining']('37'), 18);
    assert.equal(override['x-rate-limit-remaining'](undefined), undefined);
});
