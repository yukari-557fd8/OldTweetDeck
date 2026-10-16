const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

function setup(storage = {}) {
    let now = 0;
    const timers = [];
    const context = vm.createContext({
        localStorage: storage, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console, URL, URLSearchParams,
        Date: class extends Date { static now() { return now; } },
        setTimeout: resolve => timers.push(resolve),
        Event: class {}, ProgressEvent: class {},
    });
    vm.runInContext(source, context);
    const route = vm.runInContext('proxyRoutes.find(r => r.path === "/1.1/tweetdeck/clients/blackbird/all")', context);
    let state, loads = 0;
    const xhr = { onload() { loads++; state = xhr._responseText ? JSON.parse(xhr._responseText) : route.afterRequest(xhr); } };
    return { context, route, xhr, storage, get state() { return state; }, get loads() { return loads; },
        async advance(ms) { now += ms; timers.splice(0).forEach(resolve => resolve()); await Promise.resolve(); } };
}

test('fresh startup waits for verification and persists valid defaults', async () => {
    const s = setup();
    const pending = s.route.sendHandler(s.xhr);
    assert.equal(s.loads, 0);
    await s.advance(5000);
    assert.equal(s.loads, 0);
    vm.runInContext('verifiedUser = { id_str: "123" }', s.context);
    await s.advance(50);
    await pending;
    assert.equal(s.loads, 1);
    assert.equal(s.state.client.settings.default_account, 'twitter:123');
    assert.deepEqual(JSON.parse(s.storage['OTDfeeds:123']), {});
    assert.deepEqual(JSON.parse(s.storage['OTDcolumns:123']), {});
    assert.equal(JSON.parse(s.storage['OTDsettings:123']).default_account, 'twitter:123');
    assert.equal(s.storage.OTDfeeds, undefined);
    assert.equal(s.storage.OTDcolumns, undefined);
});

test('cached settings load without waiting for verification', async () => {
    const s = setup({ OTDsettings: JSON.stringify({ default_account: 'twitter:456', theme: 'dark' }) });
    await s.route.sendHandler(s.xhr);
    assert.equal(s.loads, 1);
    assert.equal(s.state.client.settings.theme, 'dark');
});

test('missing verification completes with an error and writes no defaults', async () => {
    const s = setup();
    const pending = s.route.sendHandler(s.xhr);
    await s.advance(20000);
    await pending;
    assert.equal(s.loads, 1);
    assert.equal(s.xhr._status, 503);
    assert.match(s.state.errors[0].message, /verification timed out/);
    assert.equal(s.storage.OTDsettings, undefined);
    assert.equal(s.storage['OTDsettings:123'], undefined);
});

test('a legacy deck is migrated once onto the verified login', async () => {
    const s = setup({
        OTDverifiedUser: JSON.stringify({ id_str: '7' }),
        OTDsettings: JSON.stringify({ default_account: 'twitter:7', theme: 'dark', global_filter: [{ matching: 'spam' }] }),
        OTDcolumns: JSON.stringify({ a: { id: 'a' } }),
        OTDcolumnIds: JSON.stringify(['a']),
    });
    await s.route.sendHandler(s.xhr);
    assert.equal(s.state.client.settings.theme, 'dark');
    assert.equal(s.state.client.settings.global_filter[0].matching, 'spam');
    assert.deepEqual(Array.from(s.state.client.columns), ['a']);
    assert.equal(s.storage.OTDstateMigrated, '7');
    assert.equal(s.storage.OTDsettings, undefined);
    assert.equal(JSON.parse(s.storage['OTDsettings:7']).theme, 'dark');
});

test('another login does not receive or overwrite the migrated deck', async () => {
    const s = setup({
        OTDverifiedUser: JSON.stringify({ id_str: '1' }),
        'OTDsettings:1': JSON.stringify({ theme: 'dark', default_account: 'twitter:1' }),
        'OTDcolumns:1': JSON.stringify({ col: { id: 'col' } }),
        'OTDcolumnIds:1': JSON.stringify(['col']),
        'OTDfeeds:1': JSON.stringify({ feed: { id: 'feed' } }),
        OTDstateMigrated: '1',
    });
    await s.route.sendHandler(s.xhr);
    assert.equal(s.state.client.settings.theme, 'dark');
    vm.runInContext('verifiedUser = { id_str: "2" }; ensureAccount("2");', s.context);
    const columnsRoute = vm.runInContext('proxyRoutes.find(r => r.path === "/1.1/tweetdeck/columns")', s.context);
    columnsRoute.beforeSendBody({ storage: {} }, JSON.stringify([{ id: 'other', title: 'B' }]));
    assert.equal(JSON.parse(s.storage['OTDcolumns:1']).col.id, 'col');
    assert.equal(JSON.parse(s.storage['OTDcolumns:2']).other.title, 'B');
    assert.equal(JSON.parse(s.storage['OTDsettings:1']).theme, 'dark');
    assert.equal(s.storage['OTDsettings:2'], undefined);
});
