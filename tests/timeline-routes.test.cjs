const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

function loadRoutes() {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    const routes = vm.runInContext('proxyRoutes', context);
    return (path) => routes.find(r => r.path === path);
}

function author(id, screenName) {
    return { __typename: 'User', rest_id: id, legacy: { screen_name: screenName, name: screenName, profile_image_url_https: 'https://pbs.twimg.com/a.jpg' } };
}
function tweetResult(id, user, text) {
    return {
        __typename: 'Tweet', rest_id: id,
        core: { user_results: user ? { result: user } : {} },   // `{}` is what X returns for suspended/deleted authors
        legacy: { id_str: id, conversation_id_str: id, full_text: text, user_id_str: user ? user.rest_id : '0', created_at: 'Wed Oct 14 10:00:0' + id.slice(-1) + ' +0000 2026', entities: {} },
    };
}
const entry = (id, result) => ({ entryId: 'tweet-' + id, content: { itemContent: { tweet_results: { result } } } });
const cursor = (dir, value) => ({ entryId: `cursor-${dir}-1`, content: { value } });

test('home timeline keeps good tweets when one author is unavailable', () => {
    const route = loadRoutes()('/1.1/statuses/home_timeline.json');
    const entries = [
        entry('1', tweetResult('1', author('10', 'alice'), 'first')),
        entry('2', tweetResult('2', null, 'author is gone')),
        { entryId: 'home-conversation-3', content: { items: [
            { entryId: 'home-conversation-3-tweet-3', item: { itemContent: { tweet_results: { result: tweetResult('3', author('11', 'bob'), 'third') } } } },
            { entryId: 'home-conversation-3-tweet-4', item: { itemContent: { tweet_results: { result: tweetResult('4', null, 'gone too') } } } },
        ] } },
        cursor('top', 'TOP'), cursor('bottom', 'BOTTOM'),
    ];
    const data = { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
    const tweets = route.afterRequest({ storage: { user_id: '42' }, responseText: JSON.stringify(data) });
    assert.deepEqual(Array.from(tweets, t => t.id_str).sort(), ['1', '3']);
});

test('list timeline keeps good tweets when one author is unavailable', () => {
    const route = loadRoutes()('/1.1/lists/statuses.json');
    const entries = [entry('1', tweetResult('1', author('10', 'alice'), 'first')), entry('2', tweetResult('2', null, 'gone')), cursor('bottom', 'BOTTOM')];
    const data = { data: { list: { tweets_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } };
    const tweets = route.afterRequest({ storage: { list_id: '77' }, responseText: JSON.stringify(data) });
    assert.deepEqual(Array.from(tweets, t => t.id_str), ['1']);
});

test('user timeline without a bottom cursor does not throw', () => {
    const route = loadRoutes()('/1.1/statuses/user_timeline.json');
    const entries = [entry('1', tweetResult('1', author('7', 'alice'), 'only one'))];
    const data = { data: { user: { result: { timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } } };
    const tweets = route.afterRequest({ storage: { user_id: '7' }, responseText: JSON.stringify(data) });
    assert.deepEqual(Array.from(tweets, t => t.id_str), ['1']);
});
