const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

function load() {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    const routes = vm.runInContext('proxyRoutes', context);
    const find = (path) => routes.find(r => r.path === path);
    return { context, find };
}

const graphUser = (id, screen) => ({
    __typename: 'User', rest_id: id,
    legacy: { screen_name: screen, name: screen, description: 'bio', profile_image_url_https: 'https://pbs.twimg.com/' + screen + '.jpg' },
});

test('users/show reads UserByScreenName and keeps a missing user as an error', () => {
    const show = load().find('/1.1/users/show.json');
    const xhr = { modUrl: 'https://api.x.com/1.1/users/show.json?screen_name=KagiHQ', storage: {} };
    show.beforeRequest(xhr);
    assert.ok(xhr.modUrl.includes('/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName'), xhr.modUrl);
    assert.equal(JSON.parse(new URL(xhr.modUrl).searchParams.get('variables')).screen_name, 'KagiHQ');

    const byId = { modUrl: 'https://api.x.com/1.1/users/show.json?user_id=55', storage: {} };
    show.beforeRequest(byId);
    assert.ok(byId.modUrl.includes('/mxaYWwt52eAb6OAzYHMVzg/UserByRestId'), byId.modUrl);

    const found = show.afterRequest({ responseText: JSON.stringify({ data: { user: { result: graphUser('55', 'KagiHQ') } } }) });
    assert.equal(found.id_str, '55');
    assert.equal(found.screen_name, 'KagiHQ');
    assert.equal(found.profile_image_url_https, 'https://pbs.twimg.com/KagiHQ.jpg');

    const missingXhr = { responseText: JSON.stringify({ data: { user: { result: { __typename: 'UserUnavailable' } } } }) };
    const missing = show.afterRequest(missingXhr);
    assert.equal(missingXhr._status, 404);
    assert.equal(missing.errors[0].code, 34);
});

test('list members become the legacy users array', () => {
    const { find } = load();
    const route = find('/1.1/lists/members.json');
    const xhr = { modUrl: 'https://api.x.com/1.1/lists/members.json?list_id=5&cursor=-1&count=5000', storage: {} };
    route.beforeRequest(xhr);
    const variables = JSON.parse(new URL(xhr.modUrl).searchParams.get('variables'));
    assert.ok(xhr.modUrl.includes('/yQ_0-CTekcCY2oFRTskpSw/ListMembers'), xhr.modUrl);
    assert.equal(variables.listId, '5');
    assert.equal(variables.count, 100);
    assert.equal(variables.cursor, undefined);

    const body = route.afterRequest({ responseText: JSON.stringify({ data: { list: { members_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [
        { entryId: 'user-55', content: { itemContent: { user_results: { result: graphUser('55', 'Ada') } } } },
        { entryId: 'user-gone', content: { itemContent: { user_results: { result: { __typename: 'UserUnavailable' } } } } },
        { entryId: 'cursor-bottom-1', content: { value: 'NEXT' } },
    ] }] } } } } }) });
    assert.deepEqual(Array.from(body.users, (u) => u.screen_name), ['Ada']);
    assert.equal(body.users[0].id_str, '55');
    assert.equal(body.next_cursor_str, 'NEXT');
});

test('adding a list member sends the user id learned from users/show', async () => {
    const { find } = load();
    find('/1.1/users/show.json').afterRequest({ responseText: JSON.stringify({ data: { user: { result: graphUser('55', 'Ada') } } }) });
    const add = find('/1.1/lists/members/create.json');
    const xhr = { storage: {}, modUrl: 'https://api.x.com/1.1/lists/members/create.json', send(body) { this.sent = body; } };
    add.beforeRequest(xhr);
    add.sendHandler(xhr, 'screen_name=Ada&list_id=99');
    await Promise.resolve();
    await Promise.resolve();
    const body = JSON.parse(xhr.sent);
    assert.equal(body.variables.listId, '99');
    assert.equal(body.variables.userId, '55');
    assert.equal(body.queryId, '-Kf1YVC1rNKkPvPFk7YXZw');
    assert.ok(xhr.modUrl.endsWith('/ListAddMember'));

    const list = add.afterRequest({ storage: { listId: '99' }, responseText: JSON.stringify({ data: { list: {
        id_str: '99', name: 'Reading', member_count: 3, mode: 'Private',
        user_results: { result: graphUser('1', 'owner') },
    } } }) });
    assert.equal(list.id_str, '99');
    assert.equal(list.mode, 'private');
    assert.equal(list.member_count, 3);
    assert.equal(list.user.screen_name, 'owner');
});

test('an unknown list member is not sent', async () => {
    const add = load().find('/1.1/lists/members/create.json');
    const xhr = { storage: {}, modUrl: 'https://api.x.com/1.1/lists/members/create.json', send() { this.sent = true; } };
    add.beforeRequest(xhr);
    add.sendHandler(xhr, 'screen_name=nobody&list_id=99');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(xhr.sent, undefined);
    assert.equal(xhr._status, 503);
});

test('create_all adds each resolved screen name', async () => {
    const { context, find } = load();
    find('/1.1/users/show.json').afterRequest({ responseText: JSON.stringify({ data: { user: { result: graphUser('55', 'Ada') } } }) });
    find('/1.1/users/show.json').afterRequest({ responseText: JSON.stringify({ data: { user: { result: graphUser('56', 'Bea') } } }) });
    const posts = [];
    context.XMLHttpRequest = function () {
        const req = {
            open(method, url) { this.url = url; },
            send(body) {
                posts.push(JSON.parse(body));
                this.responseText = JSON.stringify({ data: { list: { id_str: '99', name: 'Reading', member_count: posts.length, mode: 'public' } } });
                this.onload();
            },
        };
        return req;
    };
    const route = find('/1.1/lists/members/create_all.json');
    const xhr = { storage: {}, modUrl: 'https://api.x.com/1.1/lists/members/create_all.json' };
    route.beforeRequest(xhr);
    route.sendHandler(xhr, 'screen_name=Ada,Bea&list_id=99');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(posts.map(p => p.variables.userId), ['55', '56']);
    assert.ok(posts.every(p => p.variables.listId === '99'));
    const list = route.afterRequest(xhr);
    assert.equal(list.id_str, '99');
    assert.equal(list.member_count, 2);
});
