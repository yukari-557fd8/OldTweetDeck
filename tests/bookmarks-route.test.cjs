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
    return vm.runInContext('proxyRoutes', context).find(r => r.path === '/1.1/statuses/bookmarks.json');
}

const author = (id) => ({ __typename: 'User', rest_id: id, legacy: { screen_name: 'u' + id, name: 'U' + id, profile_image_url_https: 'https://pbs.twimg.com/a.jpg' } });
const tweetResult = (id) => ({
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: author('7') } },
    legacy: { id_str: id, conversation_id_str: id, full_text: 'b ' + id, user_id_str: '7', created_at: 'Wed Oct 14 10:00:00 +0000 2026', entities: {} },
});
const entry = (id) => ({ entryId: 'tweet-' + id, content: { itemContent: { tweet_results: { result: tweetResult(id) } } } });
function page(ids, cursor) {
    return JSON.stringify({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
        ...ids.map(entry),
        { entryId: 'cursor-bottom-1', content: { value: cursor } },
    ] }] } } } });
}

function prepare(route, query, actAs) {
    const xhr = {
        modUrl: 'https://api.x.com/1.1/statuses/bookmarks.json?' + query,
        modReqHeaders: { 'x-act-as-user-id': actAs },
        storage: {},
        open(method, url) { this.opened = url; },
    };
    route.beforeRequest(xhr);
    route.beforeSend(xhr);
    return xhr;
}

test('bookmark cursors and receive times stay with the acting account', () => {
    const route = loadRoute();
    const first = prepare(route, 'count=20', '42');
    assert.ok(first.modUrl.includes('/Bookmarks?'), first.modUrl);
    assert.equal(first.opened, first.modUrl);
    const variables = JSON.parse(new URL(first.modUrl).searchParams.get('variables'));
    assert.equal(variables.cursor, undefined);

    const tweets = route.afterRequest({ storage: { user_id: '42', time: 5000 }, responseText: page(['20', '19'], 'PAGE1') });
    assert.equal(tweets[0].receiveTime, 5000);
    assert.equal(tweets[1].receiveTime, 4999);

    const older = prepare(route, 'count=20&max_id=18', '42');
    assert.equal(JSON.parse(new URL(older.modUrl).searchParams.get('variables')).cursor, 'PAGE1');
    assert.equal(older.storage.time, 4999);

    const other = prepare(route, 'count=20&max_id=18', '43');
    assert.equal(JSON.parse(new URL(other.modUrl).searchParams.get('variables')).cursor, undefined);
    assert.equal(other.storage.time, undefined);

    const again = route.afterRequest({ storage: { user_id: '43', time: 8000 }, responseText: page(['19'], 'OTHER') });
    assert.equal(again[0].receiveTime, 8000);
    const own = route.afterRequest({ storage: { user_id: '42' }, responseText: page(['19'], 'IGNORED') });
    assert.equal(own[0].receiveTime, 4999);
});
