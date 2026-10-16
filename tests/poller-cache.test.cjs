const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/interception.js', 'utf8');

// Stand-in for legacy TweetDeck's chirp Interval (vendor.js createInterval): endpoints are
// {value, finite, inclusive}; chirps are plain numbers here, bigger means newer.
class Interval {
    constructor(from, to) {
        this.from = from;
        this.to = to;
        const order = Interval.compare(from, to);
        this.empty = order > 0 || (order === 0 && !(from.inclusive && to.inclusive));
        if (this.empty) { this.from = Interval.posInf; this.to = Interval.negInf; }
    }
    static compare(a, b) {
        if (a === b) return 0;
        if (a === Interval.negInf || b === Interval.posInf) return -1;
        if (b === Interval.negInf || a === Interval.posInf) return 1;
        return Math.sign(a.value - b.value);
    }
    static fromCmp(a, b) { return Interval.compare(a, b) || (b.inclusive - a.inclusive); }
    static toCmp(a, b) { return Interval.compare(a, b) || (a.inclusive - b.inclusive); }
    intersection(o) {
        if (this.empty || o.empty) return Interval.empty;
        return new Interval(Interval.fromCmp(this.from, o.from) > 0 ? this.from : o.from,
                            Interval.toCmp(this.to, o.to) > 0 ? o.to : this.to);
    }
    hull(o) {
        if (this.empty) return o;
        if (o.empty) return this;
        return new Interval(Interval.fromCmp(this.from, o.from) < 0 ? this.from : o.from,
                            Interval.toCmp(this.to, o.to) < 0 ? o.to : this.to);
    }
    contiguousWith(o) {
        if (this.empty || o.empty) return true;
        if (!this.intersection(o).empty) return true;
        return (Interval.compare(this.to, o.from) === 0 && (this.to.inclusive || o.from.inclusive))
            || (Interval.compare(o.to, this.from) === 0 && (o.to.inclusive || this.from.inclusive));
    }
    static incEnd(value) { return { value, finite: true, inclusive: true }; }
    static excEnd(value) { return { value, finite: true, inclusive: false }; }
}
Interval.negInf = { value: -Infinity, finite: false, inclusive: false };
Interval.posInf = { value: Infinity, finite: false, inclusive: false };
Interval.empty = new Interval(Interval.posInf, Interval.negInf);

// Legacy: a page covers from its oldest chirp up to the bound it was asked for.
const legacyMakeRequestResultInterval = (chirps, requested) =>
    chirps.length ? new Interval(Interval.incEnd(chirps[chirps.length - 1]), requested.to) : Interval.empty;

function legacyTD() {
    return { util: { poller: { makeRequestResultInterval: legacyMakeRequestResultInterval } } };
}

function load(TD) {
    const context = vm.createContext({
        localStorage: { OTDsettings: JSON.stringify({ default_account: 'twitter:1' }) }, location: { hostname: 'x.com' },
        XMLHttpRequest: function () {}, console: { ...console, log() {} }, URL, URLSearchParams,
        Date, setTimeout, Event: class {}, ProgressEvent: class {}, ...(TD ? { TD } : {}),
    });
    vm.runInContext(source, context);
    return context;
}

function loadState(context) {
    return vm.runInContext('proxyRoutes.find(r => r.path === "/1.1/tweetdeck/clients/blackbird/all")', context).afterRequest({});
}

const sincePoll = () => new Interval(Interval.excEnd(100), Interval.posInf);   // "newer than my newest tweet"
const cache = () => new Interval(Interval.incEnd(60), Interval.incEnd(100));   // what the poller already holds

test('a cursor poll that only returns newer tweets no longer reads as a gap', () => {
    const TD = legacyTD();
    loadState(load(TD));
    const page = [105, 103];   // nothing at or below 100, unlike a REST since_id response
    assert.equal(cache().contiguousWith(legacyMakeRequestResultInterval(page, sincePoll())), false);
    const covered = TD.util.poller.makeRequestResultInterval(page, sincePoll());
    assert.equal(cache().contiguousWith(covered), true);
    assert.deepEqual(covered.from, Interval.excEnd(100));
    assert.equal(covered.to, Interval.posInf);
});

test('infinite-scroll pages and empty pages keep their legacy extent', () => {
    const TD = legacyTD();
    loadState(load(TD));
    const older = new Interval(Interval.negInf, Interval.excEnd(50));
    const covered = TD.util.poller.makeRequestResultInterval([45, 40], older);
    assert.deepEqual([covered.from, covered.to], [Interval.incEnd(40), Interval.excEnd(50)]);
    assert.equal(TD.util.poller.makeRequestResultInterval([], sincePoll()).empty, true);
});

test('the patch is applied once and tolerates a missing legacy object', () => {
    const TD = legacyTD();
    const context = load(TD);
    loadState(context);
    const patched = TD.util.poller.makeRequestResultInterval;
    assert.notEqual(patched, legacyMakeRequestResultInterval);
    loadState(context);
    assert.equal(TD.util.poller.makeRequestResultInterval, patched);
    assert.doesNotThrow(() => loadState(load(undefined)));
});
