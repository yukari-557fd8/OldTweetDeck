const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// One OTD instance per call. `btd` puts Better TweetDeck's data-btd-ready marker on <body>.
function load({ btd = false } = {}) {
    const document = { body: { getAttribute: (name) => (btd && name === 'data-btd-ready' ? 'true' : null) } };
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' }, document,
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    const routes = vm.runInContext('proxyRoutes', context);
    return {
        parseTweet: vm.runInContext('parseTweet', context),
        legacyUserFromGraph: vm.runInContext('legacyUserFromGraph', context),
        route: (path) => routes.find(r => r.path === path),
    };
}

// GraphQL user as HomeLatestTimeline sends it in 2026-10: no legacy.verified / following, the
// checkmark in is_blue_verified and verification.verified_type, follow state in relationship_perspectives.
function graphUser(id, { blue = false, type, following = false, followedBy = false } = {}) {
    return {
        __typename: 'User', rest_id: id, is_blue_verified: blue,
        verification: { verified: false, ...(type ? { verified_type: type } : {}) },
        relationship_perspectives: { following, followed_by: followedBy, blocking: false, muting: false },
        core: { screen_name: 'user' + id, name: 'User ' + id }, avatar: { image_url: 'https://pbs.twimg.com/' + id + '.jpg' },
        legacy: { followers_count: 10 },
    };
}
function tweetResult(id, author, extra = {}) {
    return {
        __typename: 'Tweet', rest_id: id,
        core: { user_results: { result: author } },
        legacy: { id_str: id, conversation_id_str: id, full_text: 'tweet ' + id, user_id_str: author.rest_id, entities: {}, ...extra },
    };
}

// What Better TweetDeck makes of a v1.1 user (extendTwitterUser.ts): the badges it draws.
const btdBadges = (user) => ({
    legacy: !!user.verified,
    blue: !!(user.ext_is_blue_verified && !user.ext_verified_type),
    business: user.ext_verified_type === 'Business',
});

test('follow state moves from relationship_perspectives to following / followed_by', () => {
    const { parseTweet } = load();
    const tweet = parseTweet(tweetResult('100', graphUser('1', { following: true, followedBy: true })));
    assert.equal(tweet.user.following, true);
    assert.equal(tweet.user.followed_by, true);
    const stranger = parseTweet(tweetResult('101', graphUser('2')));
    assert.equal(stranger.user.following, false);
    assert.equal(stranger.user.followed_by, false);
});

test('a retweeted and a quoted author get their follow state and checkmark too', () => {
    const { parseTweet } = load();
    const quoted = tweetResult('200', graphUser('3', { blue: true, following: true }));
    const original = tweetResult('100', graphUser('1', { following: true, followedBy: true }), { quoted_status_id_str: '200' });
    original.quoted_status_result = { result: quoted };
    const retweet = tweetResult('900', graphUser('2'), { retweeted_status_result: { result: original } });
    const tweet = parseTweet(retweet);
    assert.equal(tweet.retweeted_status.user.following, true);
    assert.equal(tweet.retweeted_status.user.followed_by, true);
    assert.equal(tweet.retweeted_status.quoted_status.user.following, true);
    assert.equal(tweet.retweeted_status.quoted_status.user.verified, true);

    const quote = tweetResult('101', graphUser('4'));
    quote.quoted_status_result = { result: tweetResult('201', graphUser('5', { type: 'Business', followedBy: true })) };
    const parsed = parseTweet(quote);
    assert.equal(parsed.quoted_status.user.followed_by, true);
    assert.equal(parsed.quoted_status.user.verified, true);
});

test('without Better TweetDeck every checkmark is drawn by legacy, a Business one without Blue as well', () => {
    const { parseTweet } = load();
    const blue = parseTweet(tweetResult('100', graphUser('1', { blue: true }))).user;
    const business = parseTweet(tweetResult('101', graphUser('2', { type: 'Business' }))).user;
    const government = parseTweet(tweetResult('102', graphUser('3', { blue: true, type: 'Government' }))).user;
    const none = parseTweet(tweetResult('103', graphUser('4'))).user;
    assert.equal(blue.verified, true);
    assert.equal(blue.verified_type, 'Blue');
    assert.equal(business.verified, true);
    assert.equal(government.verified, true);
    assert.ok(!none.verified);
});

test('with Better TweetDeck running it draws each checkmark once, from the ext_ fields', () => {
    const { parseTweet } = load({ btd: true });
    const blue = parseTweet(tweetResult('100', graphUser('1', { blue: true }))).user;
    const business = parseTweet(tweetResult('101', graphUser('2', { blue: true, type: 'Business' }))).user;
    const none = parseTweet(tweetResult('102', graphUser('3'))).user;
    assert.deepEqual(btdBadges(blue), { legacy: false, blue: true, business: false });
    assert.deepEqual(btdBadges(business), { legacy: false, blue: false, business: true });
    assert.deepEqual(btdBadges(none), { legacy: false, blue: false, business: false });
});

test('X\'s own verified flag is kept with or without Better TweetDeck', () => {
    const verified = graphUser('1');
    verified.verification.verified = true;
    assert.equal(load().parseTweet(tweetResult('100', verified)).user.verified, true);
    const again = graphUser('1');
    again.verification.verified = true;
    assert.equal(load({ btd: true }).parseTweet(tweetResult('100', again)).user.verified, true);
});

test('users/show and user search users get the same follow state and checkmark', () => {
    const { legacyUserFromGraph, route } = load({ btd: true });
    const shown = legacyUserFromGraph(graphUser('1', { blue: true, following: true, followedBy: true }));
    assert.equal(shown.following, true);
    assert.equal(shown.followed_by, true);
    assert.deepEqual(btdBadges(shown), { legacy: false, blue: true, business: false });

    const result = graphUser('2', { blue: true, following: true });
    result.legacy = { screen_name: 'user2', name: 'User 2' };
    const page = { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ entries: [
        { entryId: 'user-2', content: { itemContent: { user_results: { result } } } },
    ] }] } } } } };
    const [found] = route('/1.1/users/search.json').afterRequest({ responseText: JSON.stringify(page) });
    assert.equal(found.following, true);
    assert.equal(found.ext_is_blue_verified, true);
});

test('a following flag legacy already has is kept', () => {
    const author = graphUser('1');
    author.legacy.following = true;
    assert.equal(load().parseTweet(tweetResult('100', author)).user.following, true);
});

// all.json users are v1.1 users: following and ext_ fields are there, `verified` is false.
function allJsonPage(entries, users, tweets = []) {
    return JSON.stringify({
        globalObjects: { tweets: Object.fromEntries(tweets.map(t => [t.id_str, t])), users: Object.fromEntries(users.map(u => [u.id_str, u])), notifications: Object.fromEntries(entries.filter(e => e.template).map(e => e.template)) },
        timeline: { instructions: [{ addEntries: { entries: entries.map(e => e.entry) } }] },
    });
}
const v11User = (id, extra = {}) => ({ id_str: id, screen_name: 'user' + id, name: 'User ' + id, verified: false, ext_is_blue_verified: false, following: true, followed_by: true, ...extra });
const followed = (id, sortIndex, userIds) => ({
    entry: { entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element: 'users_followed_you' }, content: { notification: { id } } } } },
    template: [id, { template: { aggregateUserActionsV1: { fromUsers: userIds.map(id => ({ user: { id } })), targetObjects: [] } } }],
});
const mention = (id, sortIndex, tweetId) => ({
    entry: { entryId: 'notification-' + id, sortIndex: String(sortIndex), content: { item: { clientEventInfo: { element: 'user_mentioned_you' }, content: { tweet: { id: tweetId } } } } },
});

test('Notifications and Mentions users get legacy\'s badge only when Better TweetDeck is not drawing one', () => {
    const users = () => [v11User('7', { ext_is_blue_verified: true }), v11User('8', { ext_verified_type: 'Business' }), v11User('9')];
    const page = () => allJsonPage([followed('n1', 1000, ['7', '8', '9']), mention('n2', 900, '100')], users(), [{ id_str: '100', user_id_str: '7', full_text: 'hi', entities: {} }]);

    const plain = load();
    const sources = Array.from(plain.route('/1.1/activity/about_me.json').afterRequest({ storage: { user_id: '42' }, responseText: page() }))
        .filter(n => n.action === 'follow').map(n => n.sources[0]);
    assert.deepEqual(sources.map(u => [u.id_str, !!u.verified]), [['7', true], ['8', true], ['9', false]]);
    const [mentioned] = plain.route('/1.1/statuses/mentions_timeline.json').afterRequest({ storage: { user_id: '42' }, responseText: page() });
    assert.equal(mentioned.user.verified, true);

    const withBtd = load({ btd: true });
    const btdSources = Array.from(withBtd.route('/1.1/activity/about_me.json').afterRequest({ storage: { user_id: '42' }, responseText: page() }))
        .filter(n => n.action === 'follow').map(n => btdBadges(n.sources[0]));
    assert.deepEqual(btdSources, [
        { legacy: false, blue: true, business: false },
        { legacy: false, blue: false, business: true },
        { legacy: false, blue: false, business: false },
    ]);
});
