const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// The "mutual follows" choice of the Tweet authors column filter in bundle.js: TD.vo.UserFilter.FROM_MUTUAL
// becomes a TD.vo.Filter.IS_FROM_MUTUAL filter whose pass() asks each chirp isFromMutualUser(). A chirp
// answers with a strict boolean on purpose: _testBoolean lets anything else through.
const source = fs.readFileSync('files/bundle.js', 'utf8');

// Source of the function assigned right after `marker`, whether it sits on one line or many.
function method(marker) {
    const at = source.indexOf(marker);
    assert.notEqual(at, -1, marker);
    const start = source.indexOf('function', at);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unterminated ' + marker);
}
// A bundle method, with the webpack imports it uses (n, o, a, r, TD) supplied by name.
const compile = (marker, scope = {}) => new Function(...Object.keys(scope), `return (${method(marker)});`)(...Object.values(scope));

const isMutualFollow = compile('TD.services.TwitterUser.prototype.isMutualFollow = ');
const user = (following, followedBy, me = false) => ({ following, followedBy, isMe: () => me, isMutualFollow });
const isFromMutualUser = compile('TD.services.TwitterStatus.prototype.isFromMutualUser = ');
const status = (author, retweeter) => ({ user: retweeter || author, getMainTweet: () => ({ user: author }), isFromMutualUser });

test('the choice, the filter type, the summary, the header flag, the user fields and the form are wired for "mutual"', () => {
    for (const marker of [
        '(TD.vo.UserFilter.FROM_MUTUAL = "mutual")',
        'e !== TD.vo.UserFilter.FROM_MUTUAL',
        'case TD.vo.UserFilter.FROM_MUTUAL: e.push((0, r.default)("by mutual follows"));',
        'case TD.vo.UserFilter.FROM_MUTUAL: (e = new TD.vo.Filter(TD.vo.Filter.IS_FROM_MUTUAL, !0, !0)), t.push(e);',
        '"mutual" === e.user.from_type',
        '(TD.vo.Filter.IS_FROM_MUTUAL = "mutual")',
        'case TD.vo.Filter.IS_FROM_VERIFIED: case TD.vo.Filter.IS_FROM_MUTUAL:',
        'case TD.vo.Filter.IS_FROM_MUTUAL: return this._testBoolean(e.isFromMutualUser());',
        '(this.followedBy = e.followed_by)',
        '(this.followedBy = r.followed_by)',
        'withMutualFollows: !t,',
        'this.attr.renderOptions.withUsersIFollow, this.attr.renderOptions.withMutualFollows',
        'u && i.push({ value: TD.vo.UserFilter.FROM_MUTUAL, title: (0, n.default)("mutual follows") }), i',
    ]) assert.ok(source.includes(marker), marker);
});

test('a user is a mutual follow only when both flags are true, and the answer is always a boolean', () => {
    assert.equal(user(true, true).isMutualFollow(), true);
    assert.equal(user(true, false).isMutualFollow(), false);
    assert.equal(user(false, true).isMutualFollow(), false);
    assert.equal(user(true, undefined).isMutualFollow(), false);
    assert.equal(user(undefined, undefined).isMutualFollow(), false);
});

test('a tweet passes when its author or its retweeter is a mutual follow, or is the logged-in user', () => {
    const mutual = user(true, true), stranger = user(true, false), me = user(false, false, true);
    assert.equal(status(mutual).isFromMutualUser(), true);
    assert.equal(status(stranger).isFromMutualUser(), false);
    assert.equal(status(user(undefined, undefined)).isFromMutualUser(), false);
    assert.equal(status(stranger, mutual).isFromMutualUser(), true);   // a mutual's retweet of anyone
    assert.equal(status(mutual, stranger).isFromMutualUser(), true);   // a mutual's tweet, retweeted by anyone
    assert.equal(status(me).isFromMutualUser(), true);
    assert.equal(status(me, stranger).isFromMutualUser(), true);
});

test('a notification passes by the account that acted, and other chirps never pass', () => {
    const action = (creator) => ({ getCreator: () => creator, isFromMutualUser: compile('TD.services.TwitterAction.prototype.isFromMutualUser = ') });
    assert.equal(action(user(true, true)).isFromMutualUser(), true);
    assert.equal(action(user(true, false)).isFromMutualUser(), false);
    assert.equal(action(user(false, false, true)).isFromMutualUser(), true);
    assert.equal(compile('TD.services.ChirpBase.prototype.isFromMutualUser = ').call({}), false);
});

test('the filter passes a true answer, drops a false one, and would let a non-boolean through', () => {
    const constants = {};
    for (const [, name, value] of source.matchAll(/\(TD\.vo\.Filter\.([A-Z_]+) = "([a-z_]+)"\)/g)) constants[name] = value;
    assert.equal(constants.IS_FROM_MUTUAL, 'mutual');
    const TD = { vo: { Filter: constants } };
    const lodash = {
        n: { default: (v) => typeof v === 'boolean' },
        o: { default: (list, fn) => list.map(fn) }, a: { default: (list, fn) => list.some(fn) }, r: { default: (list, fn) => list.every(fn) },
    };
    const filter = {
        type: 'mutual', value: true, positive: true, filterTarget: 'parent',
        _testBoolean: compile('TD.vo.Filter.prototype._testBoolean = ', { n: lodash.n }),
        _getFilterTarget: compile('TD.vo.Filter.prototype._getFilterTarget = '),
        pass: compile('TD.vo.Filter.prototype.pass = ', { TD, o: lodash.o, a: lodash.a, r: lodash.r }),
    };
    const chirp = (answer) => ({ sourceNoHTML: '', getFilterableText: () => '', getSenders: () => [], isFromMutualUser: () => answer });
    assert.equal(filter.pass(chirp(true)), true);
    assert.equal(filter.pass(chirp(false)), false);
    assert.equal(filter.pass(chirp(undefined)), true);
});

test('the quoted tweet is held to every column filter except the mutual one', () => {
    const calls = [];
    const TD = { controller: { filterManager: { pass: (chirp, filters) => (calls.push([chirp, filters]), true) } }, vo: { Filter: { IS_FROM_MUTUAL: 'mutual' } } };
    const passFilters = compile('TD.services.TwitterStatus.prototype.passFilters = ', { TD });
    const filters = [{ type: 'mutual' }, { type: 'phrase' }];
    const quoted = { id: 'quoted' };
    assert.equal(passFilters.call({ quotedTweet: quoted }, filters), true);
    assert.equal(calls[0][1], filters);
    assert.equal(calls[1][0], quoted);
    assert.deepEqual(calls[1][1], [{ type: 'phrase' }]);
    calls.length = 0;
    passFilters.call({ quotedTweet: null }, filters);
    assert.equal(calls.length, 1);
    passFilters.call({ quotedTweet: quoted }, undefined);
    assert.equal(calls[2][1], undefined);
});

test('bundle.js keeps its line count, so the roadmap line numbers stay valid', () => {
    assert.equal(source.split('\n').length - 1, 76373);
});
