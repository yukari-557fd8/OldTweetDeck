const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

class FakeNotification {
    static permission = 'granted';
    static requestPermission(callback) { callback('granted'); return 'asked'; }
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; }
    close() { this.closed = true; }
}

test('legacy cannot close a desktop notification five seconds after it shows', () => {
    const context = vm.createContext({
        localStorage: {}, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {}, warn() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {}, Notification: FakeNotification,
    });
    vm.runInContext(source, context);
    // What TD.controller.notifications does with window.Notification (bundle.js).
    const d = vm.runInContext('Notification', context);
    assert.ok('permission' in d);
    assert.equal(d.permission, 'granted');
    assert.equal(d.requestPermission(() => {}), 'asked');
    const t = new d('New mention', { body: 'hello', icon: 'avatar.png' });
    let closeLater = null;
    t.onshow = function () { closeLater = () => t.close(); };
    assert.equal(t.onshow, null);
    assert.equal(closeLater, null);
    assert.ok(t instanceof FakeNotification);
    assert.equal(t.options.body, 'hello');
    assert.equal(t.closed, false);
});
