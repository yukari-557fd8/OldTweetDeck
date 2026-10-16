const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

function loadParseTweet(storage = {}) {
    const context = vm.createContext({
        localStorage: storage, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    return vm.runInContext('parseTweet', context);
}

// GraphQL user result, either in the legacy shape or in the newer core/avatar shape.
function user(id, screenName, { legacy = true } = {}) {
    const base = { __typename: 'User', rest_id: id, is_blue_verified: false };
    const avatar = 'https://pbs.twimg.com/' + screenName + '.jpg';
    return legacy
        ? { ...base, legacy: { screen_name: screenName, name: screenName.toUpperCase(), profile_image_url_https: avatar } }
        : { ...base, core: { screen_name: screenName, name: screenName.toUpperCase(), created_at: 'Mon Jan 01 00:00:00 +0000 2024' }, avatar: { image_url: avatar } };
}
function tweetResult(id, author, text) {
    return {
        __typename: 'Tweet', rest_id: id,
        core: { user_results: { result: author } },
        legacy: { id_str: id, conversation_id_str: id, full_text: text, user_id_str: author.rest_id, entities: {} },
    };
}
function retweetOf(inner) {
    return {
        __typename: 'Tweet', rest_id: '900',
        core: { user_results: { result: user('2', 'bob') } },
        legacy: { id_str: '900', conversation_id_str: '900', full_text: 'RT @alice: hello world', user_id_str: '2', entities: {}, retweeted_status_result: { result: inner } },
    };
}

test('plain retweet keeps working', () => {
    const tweet = loadParseTweet()(retweetOf(tweetResult('100', user('1', 'alice'), 'hello world')));
    assert.equal(tweet.retweeted_status.text, 'hello world');
    assert.equal(tweet.retweeted_status.id, 100);
    assert.equal(tweet.retweeted_status.user.screen_name, 'alice');
});

test('retweet wrapped in TweetWithVisibilityResults without limitedActionResults is unwrapped', () => {
    const inner = {
        __typename: 'TweetWithVisibilityResults',
        tweet: tweetResult('100', user('1', 'alice'), 'hello world'),
        mediaVisibilityResults: { blurred_image_interstitial: { opacity: 0.5 } },
    };
    const tweet = loadParseTweet()(retweetOf(inner));
    assert.ok(tweet.retweeted_status, 'retweeted_status must be present, otherwise TweetDeck renders the raw RT text');
    assert.equal(tweet.retweeted_status.text, 'hello world');
    assert.equal(tweet.retweeted_status.user.screen_name, 'alice');
});

test('retweet wrapped with limitedActionResults still records the reply limitation', () => {
    const inner = {
        __typename: 'TweetWithVisibilityResults',
        tweet: tweetResult('100', user('1', 'alice'), 'hello world'),
        limitedActionResults: { limited_actions: [{ action: 'Reply', prompt: { subtext: { text: 'Only mentioned users can reply' } } }] },
    };
    const tweet = loadParseTweet()(retweetOf(inner));
    assert.equal(tweet.retweeted_status.text, 'hello world');
    assert.equal(tweet.retweeted_status.limited_actions_text, 'Only mentioned users can reply');
});

test('retweeted author without a legacy object is rebuilt from core/avatar', () => {
    const tweet = loadParseTweet()(retweetOf(tweetResult('100', user('1', 'alice', { legacy: false }), 'hello world')));
    assert.equal(tweet.retweeted_status.user.screen_name, 'alice');
    assert.equal(tweet.retweeted_status.user.name, 'ALICE');
    assert.equal(tweet.retweeted_status.user.id_str, '1');
    assert.equal(tweet.retweeted_status.user.profile_image_url_https, 'https://pbs.twimg.com/alice.jpg');
});

test('unavailable retweeted tweet does not throw', () => {
    const tweet = loadParseTweet()(retweetOf({ __typename: 'TweetUnavailable', reason: 'Protected' }));
    assert.equal(tweet.retweeted_status, undefined);
    assert.equal(tweet.text, 'RT @alice: hello world');
});

test('tweet whose author is unavailable (user_results: {}) is skipped instead of throwing', () => {
    const res = { __typename: 'Tweet', rest_id: '100', core: { user_results: {} }, legacy: { id_str: '100', conversation_id_str: '100', full_text: 'x', user_id_str: '1', entities: {} } };
    assert.equal(loadParseTweet()(res), undefined);
});

test('quoted tweet whose author is unavailable is dropped but the tweet survives', () => {
    const res = tweetResult('100', user('1', 'alice'), 'look at this');
    res.legacy.is_quote_status = true;
    res.quoted_status_result = { result: { __typename: 'Tweet', rest_id: '50', core: { user_results: {} }, legacy: { id_str: '50', conversation_id_str: '50', full_text: 'q', user_id_str: '9', entities: {} } } };
    const tweet = loadParseTweet()(res);
    assert.equal(tweet.text, 'look at this');
    assert.equal(tweet.quoted_status, undefined);
});

test('quoted author without a legacy object is rebuilt from core/avatar', () => {
    const res = tweetResult('100', user('1', 'alice'), 'look at this');
    res.legacy.is_quote_status = true;
    res.quoted_status_result = { result: tweetResult('50', user('9', 'carol', { legacy: false }), 'quoted text') };
    const tweet = loadParseTweet()(res);
    assert.equal(tweet.quoted_status.text, 'quoted text');
    assert.equal(tweet.quoted_status.user.screen_name, 'carol');
    assert.equal(tweet.quoted_status.user.id_str, '9');
});

function noteTweet(text) {
    const truncated = 'short preview … https://t.co/aaaaaaaaaa';
    return {
        __typename: 'Tweet', rest_id: '70',
        core: { user_results: { result: user('1', 'alice') } },
        legacy: { id_str: '70', conversation_id_str: '70', full_text: truncated, user_id_str: '1', entities: {} },
        note_tweet: { note_tweet_results: { result: { text, entity_set: { hashtags: [], urls: [], user_mentions: [] } } } },
    };
}

test('a long tweet stays truncated unless autoexpand is on', () => {
    const full = 'word '.repeat(80).trim();
    const collapsed = loadParseTweet()(noteTweet(full));
    assert.equal(collapsed.full_text, 'short preview … https://t.co/aaaaaaaaaa');
    const expanded = loadParseTweet({ OTDenableAutoExpand: '1' })(noteTweet(full));
    assert.equal(expanded.full_text, full);
    assert.equal(expanded.text, full);
});

test('a video unified card becomes native video media', () => {
    const res = tweetResult('80', user('1', 'alice'), 'watch');
    res.card = { legacy: { name: 'unified_card', binding_values: { unified_card: { string_value: JSON.stringify({
        type: 'video_website',
        components: ['media_1'],
        component_objects: { media_1: { type: 'media', data: { id: 'm1', destination: 'd1' } } },
        media_entities: { m1: { id_str: 'm1', type: 'video', media_url_https: 'https://pbs.twimg.com/thumb.jpg', video_info: { aspect_ratio: [16, 9], variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8' },
            { bitrate: 832000, content_type: 'video/mp4', url: 'https://video.twimg.com/high.mp4' },
        ] } } },
        destination_objects: { d1: { type: 'browser', data: { url_data: { url: 'https://example.com/v', vanity: 'example.com' } } } },
    }) } } } };
    const tweet = loadParseTweet()(res);
    assert.equal(tweet.card, undefined);
    assert.equal(tweet.extended_entities.media[0].type, 'video');
    assert.equal(tweet.extended_entities.media[0].video_info.variants[1].url, 'https://video.twimg.com/high.mp4');
});
