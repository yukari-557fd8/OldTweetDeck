const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// Stand-in for the browser's XMLHttpRequest: records open/send/headers and delivers a response the
// way the browser would (legacy then reads status first, body second).
class FakeXHR {
    constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
        this.headers = {}; this.opened = null; this.sent = false;
        this.onload = null; this.onloadend = null; this.onerror = null; this.onreadystatechange = null;
    }
    open(method, url, async) { this.readyState = 1; this.opened = { method, url, async }; }
    setRequestHeader(name, value) { if (this.readyState !== 1) throw new Error('state must be OPENED'); this.headers[name] = value; }
    send() { if (this.readyState !== 1) throw new Error('state must be OPENED'); this.sent = true; }
    addEventListener() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ''; }
    abort() {}
    respond(status, text) { this.status = status; this.responseText = text; this.readyState = 4; if (this.onload) this.onload({}); }
}

function load(TD) {
    const context = vm.createContext({
        localStorage: { twitterAccountID: '1', OTDsettings: JSON.stringify({ default_account: 'twitter:1' }) },
        location: { hostname: 'x.com' }, navigator: { language: 'en-US' },
        XMLHttpRequest: FakeXHR, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
        solveChallenge: async () => 'tx', ...(TD ? { TD } : {}),
    });
    context.window = context;
    vm.runInContext(source, context);
    vm.runInContext('Math.random = () => 0', context);   // the Home poll throttle drops 40% of polls at random
    return context;
}
const route = (context, path) => vm.runInContext('proxyRoutes', context).find(r => r.path === path);
const HOME = '/1.1/statuses/home_timeline.json';

// What legacy TweetDeck does for a Home request: open, add the Teams header, send, read status then body.
async function homeRequest(context, query, actAs) {
    const XHR = vm.runInContext('XMLHttpRequest', context);
    const xhr = new XHR();
    xhr.open('GET', 'https://api.x.com/1.1/statuses/home_timeline.json?' + query, true);
    if (actAs) xhr.setRequestHeader('x-act-as-user-id', actAs);
    const result = { xhr, loaded: null };
    xhr.onload = () => { result.loaded = { status: xhr.status, text: xhr.responseText }; };
    await xhr.send(null);
    return result;
}
const cursorIn = (xhr) => JSON.parse(new URL(xhr.opened.url).searchParams.get('variables')).cursor;

const author = (id) => ({ __typename: 'User', rest_id: id, legacy: { screen_name: 'u' + id, name: 'u' + id, profile_image_url_https: 'https://pbs.twimg.com/a.jpg' } });
function tweetResult(id, extra = {}) {
    return { __typename: 'Tweet', rest_id: id, core: { user_results: { result: author('9' + id) } }, ...extra,
        legacy: { id_str: id, conversation_id_str: id, full_text: 'tweet ' + id, user_id_str: '9' + id, created_at: 'Wed Oct 14 10:00:00 +0000 2026', entities: {} } };
}
const entry = (id, extra) => ({ entryId: 'tweet-' + id, content: { itemContent: { tweet_results: { result: tweetResult(id, extra) } } } });
const conversation = (ids) => ({ entryId: 'home-conversation-' + ids[0], content: { items: ids.map(id =>
    ({ entryId: `home-conversation-${ids[0]}-tweet-${id}`, item: { itemContent: { tweet_results: { result: tweetResult(id) } } } })) } });
const cursor = (dir, value) => ({ entryId: `cursor-${dir}-1`, content: { value } });
const page = (entries) => JSON.stringify({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } });
const ids = (text) => JSON.parse(text).map(t => t.id_str);

test('a Teams account resolves its own Home cursors at send time', async () => {
    const ctx = load();
    const first = await homeRequest(ctx, 'count=40', '42');
    assert.ok(first.xhr.opened.url.includes('HomeLatestTimeline'), first.xhr.opened.url);
    assert.equal(cursorIn(first.xhr), undefined);
    assert.equal(first.xhr.headers['x-act-as-user-id'], '42');
    assert.equal(first.xhr.headers['x-client-transaction-id'], 'tx');
    first.xhr.respond(200, page([entry('30'), entry('20'), cursor('top', 'TOP1'), cursor('bottom', 'BOT1')]));
    assert.deepEqual(ids(first.loaded.text), ['30', '20']);

    // legacy scrolls down with max_id = the bottom chirp's id minus one ...
    const older = await homeRequest(ctx, 'count=40&max_id=19', '42');
    assert.equal(cursorIn(older.xhr), 'BOT1');
    // ... and polls with since_id = its second-newest chirp
    const newer = await homeRequest(ctx, 'count=40&since_id=20', '42');
    assert.equal(cursorIn(newer.xhr), 'TOP1');

    // the login account never got that page, so its request must not borrow 42's cursor
    const other = await homeRequest(ctx, 'count=40&max_id=19');
    assert.equal(other.xhr.opened, null);
    assert.equal(other.loaded.status, 503);
    assert.equal(other.loaded.text, '[]');
});

test('a conversation module keeps older tweets only where the page reaches, in time order, and any id finds the page', () => {
    const ctx = load();
    const tweets = route(ctx, HOME).afterRequest({ storage: { user_id: '42' }, responseText: page([
        entry('50'), conversation(['10', '40']), conversation(['35', '45']), entry('30'), cursor('top', 'TOP'), cursor('bottom', 'BOT'),
    ]) });
    // 10 is older than anything else on the page: at its own id it would become the bottom chirp,
    // next to its reply it would be an old tweet out of order, so it is left out
    assert.deepEqual(Array.from(tweets, t => t.id_str), ['50', '45', '40', '35', '30']);
    assert.ok(tweets.every(t => t.receiveTime === undefined));
    const timelineCursor = vm.runInContext('timelineCursor', ctx);
    for (const id of ['50', '45', '40', '35', '30']) {
        assert.equal(timelineCursor('home-42', id, 'bottom'), 'BOT');
        assert.equal(timelineCursor('home-42', id, 'top'), 'TOP');
    }
});

test('a poll keeps a new reply but not the older tweets of its conversation', () => {
    const ctx = load();
    const home = route(ctx, HOME);
    home.afterRequest({ storage: { user_id: '42' }, responseText: page([entry('50'), entry('30'), cursor('top', 'TOP1')]) });
    const polled = home.afterRequest({ storage: { user_id: '42', since_id: '50' }, responseText: page([
        conversation(['20', '45', '60']), entry('55'), cursor('top', 'TOP2'),
    ]) });
    assert.deepEqual(Array.from(polled, t => t.id_str), ['60', '55']);
});

test('a page where nothing survives the filters moves the bound one page deeper', () => {
    const ctx = load();
    const home = route(ctx, HOME);
    home.afterRequest({ storage: { user_id: '42' }, responseText: page([entry('30'), entry('20'), cursor('bottom', 'BOT1')]) });
    const nothing = home.afterRequest({ storage: { user_id: '42', requested_id: '20' }, responseText: page([
        entry('15', { source: '<a href="https://ads.x.com">Twitter for Advertisers</a>' }), cursor('bottom', 'BOT2'),
    ]) });
    assert.deepEqual(Array.from(nothing), []);
    assert.equal(vm.runInContext('timelineCursor', ctx)('home-42', '20', 'bottom'), 'BOT2');
});

test('a 200 whose body is only a GraphQL error is delivered as a failed request', async () => {
    const ctx = load();
    const r = await homeRequest(ctx, 'count=40', '42');
    r.xhr.respond(200, JSON.stringify({ errors: [{ message: 'over capacity' }] }));
    assert.equal(r.loaded.status, 503);
    assert.equal(r.loaded.text, '[]');
    assert.deepEqual(Array.from(route(ctx, HOME).afterRequest({ storage: { user_id: '42' }, responseText: '{"data":{}}' })), []);
});

test('since polls use the page cursor and resync from the top every ten minutes', async () => {
    const ctx = load();
    const first = await homeRequest(ctx, 'count=40', '42');
    first.xhr.respond(200, page([entry('30'), entry('20'), cursor('top', 'TOP1'), cursor('bottom', 'BOT1')]));
    assert.equal(cursorIn((await homeRequest(ctx, 'count=40&since_id=20', '42')).xhr), 'TOP1');
    vm.runInContext('topFetches', ctx)['home-42'] = 0;      // the last cursor-less fetch was long ago
    assert.equal(cursorIn((await homeRequest(ctx, 'count=40&since_id=20', '42')).xhr), undefined);
    assert.equal(cursorIn((await homeRequest(ctx, 'count=40&since_id=20', '42')).xhr), 'TOP1');
});

test('legacy FeedPoller stops treating a short page as the end of the feed', () => {
    const WHOLE = { whole: true };
    function Original(feed) {
        this.feed = feed; this.EXHAUSTED_API_THRESHOLD = 10;
        this.intervalOfPossibility = { empty: true, constructor: { whole: WHOLE } };
        this.refresh = function (opts) { return [this.intervalOfPossibility, opts]; };
    }
    Original.FEED_TYPES = { home: 'home' };
    const TD = { controller: { FeedPoller: Original }, util: { poller: { makeRequestResultInterval() {} } } };
    const ctx = load(TD);
    const loadState = () => vm.runInContext('proxyRoutes.find(r => r.path === "/1.1/tweetdeck/clients/blackbird/all")', ctx).afterRequest({});
    loadState();
    const Patched = TD.controller.FeedPoller;
    assert.notEqual(Patched, Original);
    const poller = new Patched('feed');
    assert.equal(poller.EXHAUSTED_API_THRESHOLD, 1);
    assert.ok(poller instanceof Original);
    assert.equal(Patched.FEED_TYPES.home, 'home');
    assert.deepEqual(poller.refresh({ reset: true }), [WHOLE, { reset: true }]);   // an "exhausted" feed is possible again on refresh
    loadState();
    assert.equal(TD.controller.FeedPoller, Patched);
});

test('list timelines drop conversation tweets older than the page, map every id to the page and fail fast on an unknown bound', () => {
    const ctx = load();
    const list = route(ctx, '/1.1/lists/statuses.json');
    const listPage = JSON.stringify({ data: { list: { tweets_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
        { entryId: 'list-conversation-10', content: { items: ['10', '40'].map(id =>
            ({ entryId: `list-conversation-10-tweet-${id}`, item: { itemContent: { tweet_results: { result: tweetResult(id) } } } })) } },
        entry('30'), cursor('bottom', 'LBOT'),
    ] }] } } } } });
    const tweets = list.afterRequest({ storage: { list_id: '77' }, responseText: listPage });
    assert.deepEqual(Array.from(tweets, t => t.id_str), ['40', '30']);
    assert.equal(vm.runInContext('timelineCursor', ctx)('list-77', '40', 'bottom'), 'LBOT');

    const request = (query) => ({ modUrl: 'https://api.x.com/1.1/lists/statuses.json?' + query, storage: {}, modReqHeaders: {}, open() { this.opened = true; } });
    const known = request('list_id=77&max_id=29');
    list.beforeRequest(known); list.openHandler(known, 'GET', known.modUrl, true);
    assert.equal(known.opened, true);
    assert.equal(JSON.parse(new URL(known.modUrl).searchParams.get('variables')).cursor, 'LBOT');
    const unknown = request('list_id=77&max_id=1');
    list.beforeRequest(unknown); list.openHandler(unknown, 'GET', unknown.modUrl, true);
    assert.equal(unknown.opened, undefined);
    assert.equal(unknown._status, 503);
    assert.equal(unknown.storage.cancelled, true);
});
