const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// TD.util's permalink pattern in bundle.js (createUrlAnchor, extractTweetIdFromPermalink). A link it
// matches opens the tweet, user or list inside TweetDeck; anything else opens a new tab.
const line = fs.readFileSync('files/bundle.js', 'utf8').split('\n')
    .find((l) => l.trim().startsWith('/^https?:\\/\\/') && l.includes('status(?:es)?'));
const permalink = new Function(`return ${line.trim().replace(/,$/, '')}`)();
const parts = (url) => {
    const m = url.match(permalink);
    return m && { screenName: m[1], tweetId: m[2], kind: m[3], slug: m[4] };
};

test('x.com links resolve like twitter.com links', () => {
    assert.deepEqual(parts('https://x.com/jack/status/20'), { screenName: 'jack', tweetId: '20', kind: undefined, slug: undefined });
    assert.deepEqual(parts('https://twitter.com/jack/status/20'), parts('https://x.com/jack/status/20'));
    assert.equal(parts('https://mobile.x.com/jack/status/20?s=20').tweetId, '20');
    assert.equal(parts('https://www.x.com/jack').screenName, 'jack');
    assert.deepEqual(parts('https://x.com/i/lists/123'), { screenName: 'i', tweetId: undefined, kind: '/lists/', slug: '123' });
});

test('other hosts are not taken for X links', () => {
    assert.equal(parts('https://fxtwitter.com/jack/status/20'), null);
    assert.equal(parts('https://x.company.com/jack/status/20'), null);
    assert.equal(parts('https://box.com/jack/status/20'), null);
});
