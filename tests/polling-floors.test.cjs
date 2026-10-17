const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// Legacy's feed scheduler floors (bundle.js defaults) and a TwitterClient that records the feed type
// each activity request would report its rate-limit headers under.
function legacyTD() {
    const calls = [];
    function TwitterClient() {}
    TwitterClient.prototype.getActivityTimeline = function (path, since, max, count, success, error, params, feedType) {
        calls.push([path, feedType]);
    };
    const floors = { home: 4, favorites: 4, search: 15, usertweets: 5, networkactivity: 45, scheduled: 960, bookmarks: 4 };
    return { calls, floors, client: new TwitterClient(), TD: { controller: { feedScheduler: { FEED_TYPE_TO_MINIMUM_REFRESH_PERIOD: floors } }, services: { TwitterClient } } };
}

function load(storage = {}, TD) {
    const context = vm.createContext({
        localStorage: storage, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
        ...(TD ? { TD } : {}),
    });
    vm.runInContext(source, context);
    return context;
}

test('Home keeps 4 s, Notifications and Mentions poll from 7 s, Bookmarks from 60 s, the rest is untouched', () => {
    const legacy = legacyTD();
    vm.runInContext('tuneLegacyPolling()', load({}, legacy.TD));
    assert.deepEqual({ ...legacy.floors }, {
        home: 4, favorites: 4, search: 15, usertweets: 5, networkactivity: 45, scheduled: 960, bookmarks: 60,
        interactions: 7, mentions: 7,
    });
});

test('each floor can be set in localStorage, in seconds, and a bad value keeps the default', () => {
    const legacy = legacyTD();
    const storage = { OTDhomeRefreshSeconds: '6', OTDnotificationsRefreshSeconds: '10', OTDbookmarksRefreshSeconds: 'never' };
    vm.runInContext('tuneLegacyPolling()', load(storage, legacy.TD));
    assert.equal(legacy.floors.home, 6);
    assert.equal(legacy.floors.interactions, 10);
    assert.equal(legacy.floors.mentions, 10);
    assert.equal(legacy.floors.bookmarks, 60);
});

test('the Notifications request reports its rate limit under `interactions`, other activity requests are left alone', () => {
    const legacy = legacyTD();
    vm.runInContext('tuneLegacyPolling()', load({}, legacy.TD));
    legacy.client.getActivityTimeline('activity/about_me.json', 1, null, 20, null, null, {}, null);
    legacy.client.getActivityTimeline('activity/by_friends.json', 1, null, 20, null, null, {}, null);
    legacy.client.getActivityTimeline('activity/about_me.json', 1, null, 20, null, null, {}, 'custom');
    assert.deepEqual(legacy.calls, [
        ['activity/about_me.json', 'interactions'],
        ['activity/by_friends.json', null],
        ['activity/about_me.json', 'custom'],
    ]);
});

test('before legacy has loaded nothing is patched, and the next state load applies it once', () => {
    const context = load();
    vm.runInContext('tuneLegacyPolling()', context);   // no TD yet: must not throw
    const legacy = legacyTD();
    context.TD = legacy.TD;
    vm.runInContext('tuneLegacyPolling(); tuneLegacyPolling()', context);
    assert.equal(legacy.floors.interactions, 7);
    legacy.client.getActivityTimeline('activity/about_me.json', 1, null, 20, null, null, {}, null);
    assert.deepEqual(legacy.calls, [['activity/about_me.json', 'interactions']]);
});
