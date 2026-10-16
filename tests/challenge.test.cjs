const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/challenge.js', 'utf8');

// The solver iframe is created but #injected-body never appears, so it is never attached.
function load() {
    const timers = [];
    const iframe = { style: {}, contentWindow: null, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const context = vm.createContext({
        document: { createElement: () => iframe, getElementById: () => null },
        window: { addEventListener() {} },
        fetch: () => new Promise(() => {}), indexedDB: { open: () => ({}) },
        setTimeout: (fn, ms) => timers.push({ fn, ms }), setInterval: () => 1, clearInterval() {},
        localStorage: {}, location: { hostname: 'x.com' }, console: { ...console, log() {}, warn() {}, error() {} },
    });
    vm.runInContext(source, context);
    const solve = vm.runInContext('solveChallenge', context);
    const run = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
    return { iframe, run, solve: (...args) => solve(...args).then(() => 'solved', (e) => e) };
}

// Without the fix this solve never settles, so fail it instead of hanging the run.
test('a solve fails when the solver iframe never loads', { timeout: 2000 }, async () => {
    const { solve, run } = load();
    const outcome = solve('/1.1/account/verify_credentials.json', 'GET');
    run(30000);
    assert.equal(await outcome, 'Solver did not load');
});

test('once the iframe has loaded, the usual 20 s timeout applies', async () => {
    const { solve, run, iframe } = load();
    const outcome = solve('/1.1/account/verify_credentials.json', 'GET');
    const posted = [];
    iframe.contentWindow = { postMessage: (message) => posted.push(message.action) };
    iframe.listeners.forEach((fn) => fn());
    run(30000);
    run(20000);
    assert.deepEqual(posted, ['solve']);
    assert.equal(await outcome, 'Solver timed out');
});
