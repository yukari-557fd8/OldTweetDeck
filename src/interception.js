const PUBLIC_TOKENS = [
    "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
];
const NEW_API = `https://${location.hostname}/i/api/graphql`;
const cursors = {};
const OTD_INIT_TIME = Date.now();

const generateID = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

let verifiedUser;
if(localStorage.OTDverifiedUser) {
    try {
        verifiedUser = JSON.parse(localStorage.OTDverifiedUser);
    } catch(e) {
        console.warn(`Error parsing OTDverifiedUser.`, e);
        verifiedUser = null;
    }
}
// Deck state is per login account. Teams columns stay in that one deck: the key is the
// verified login, not the x-act-as-user-id of a column. Older builds stored one global deck.
let feeds = {};
let columns = {};
let settings;
let activeAccountId = null;
let pendingLegacyOwner = false;

function hasStored(key) {
    const value = localStorage[key];
    // Browsers return null for a missing localStorage key. The test double returns undefined.
    return value !== undefined && value !== null && value !== "";
}

function readStoredJSON(key) {
    if (!hasStored(key)) return undefined;
    try {
        return JSON.parse(localStorage[key]);
    } catch (e) {
        console.warn(`Error parsing ${key}.`, e);
        return undefined;
    }
}

function stateKey(name, userId) {
    return `OTD${name}:${userId}`;
}

function accountHasStoredState(userId) {
    return ["feeds", "columns", "settings", "columnIds"].some((name) => hasStored(stateKey(name, userId)));
}

function hasLegacyBundle() {
    return ["OTDfeeds", "OTDcolumns", "OTDsettings", "OTDcolumnIds"].some((key) => hasStored(key));
}

function columnIdsOfActive() {
    const key = activeAccountId ? stateKey("columnIds", activeAccountId) : "OTDcolumnIds";
    return readStoredJSON(key) || [];
}

function writeColumnIds(ids) {
    const key = activeAccountId ? stateKey("columnIds", activeAccountId) : "OTDcolumnIds";
    localStorage[key] = JSON.stringify(ids);
}

function persistAccountState() {
    const suffix = activeAccountId ? `:${activeAccountId}` : "";
    localStorage["OTDfeeds" + suffix] = JSON.stringify(feeds);
    localStorage["OTDcolumns" + suffix] = JSON.stringify(columns);
    if (settings) localStorage["OTDsettings" + suffix] = JSON.stringify(settings);
}

function loadStoredAccount(userId) {
    feeds = readStoredJSON(stateKey("feeds", userId)) || {};
    columns = readStoredJSON(stateKey("columns", userId)) || {};
    const stored = readStoredJSON(stateKey("settings", userId));
    settings = stored === undefined ? null : stored;
    activeAccountId = String(userId);
    pendingLegacyOwner = false;
}

// The global keys belong to whichever login opens TweetDeck first after this change.
function migrateLegacyTo(userId) {
    feeds = readStoredJSON("OTDfeeds") || {};
    columns = readStoredJSON("OTDcolumns") || {};
    const stored = readStoredJSON("OTDsettings");
    settings = stored === undefined ? null : stored;
    activeAccountId = String(userId);
    pendingLegacyOwner = false;
    const columnIds = readStoredJSON("OTDcolumnIds") || [];
    persistAccountState();
    writeColumnIds(columnIds);
    localStorage.OTDstateMigrated = String(userId);
    delete localStorage.OTDfeeds;
    delete localStorage.OTDcolumns;
    delete localStorage.OTDsettings;
    delete localStorage.OTDcolumnIds;
}

function ensureAccount(userId) {
    if (!userId) return;
    userId = String(userId);
    if (activeAccountId === userId) return;
    if (pendingLegacyOwner && !localStorage.OTDstateMigrated) {
        migrateLegacyTo(userId);
        return;
    }
    if (activeAccountId) persistAccountState();
    if (accountHasStoredState(userId)) {
        loadStoredAccount(userId);
        return;
    }
    if (!localStorage.OTDstateMigrated && hasLegacyBundle()) {
        migrateLegacyTo(userId);
        return;
    }
    feeds = {};
    columns = {};
    settings = null;
    activeAccountId = userId;
    pendingLegacyOwner = false;
}

if (verifiedUser?.id_str) {
    ensureAccount(verifiedUser.id_str);
} else if (!localStorage.OTDstateMigrated && localStorage.OTDsettings) {
    feeds = readStoredJSON("OTDfeeds") || {};
    columns = readStoredJSON("OTDcolumns") || {};
    settings = readStoredJSON("OTDsettings");
    pendingLegacyOwner = true;
}
let seenNotifications = new Set();
// Legacy chirp id -> the position we first handed out for it, so a notification that has to be
// re-sent (another column's poller didn't have it yet) doesn't jump when its aggregate moves.
let notificationPositions = new Map();
let seenHomeTweets = {};
let timings = {
    list: {},
    user: {},
    search: {},
}
let refreshInterval = localStorage.OTDrefreshInterval ? parseInt(localStorage.OTDrefreshInterval) : 35000;

function exportState() {
	const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({
        feeds, 
        columns,
        settings,
        columnIds: columnIdsOfActive()
    })], {type: 'application/json'}));
    a.download = 'OTDState.json';
    a.click();
}

function importState() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
        const file = input.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            try {
                const data = JSON.parse(text);
                if(!data.feeds || !data.columns || !data.settings || !data.columnIds) {
                    throw new Error("Invalid file");
                }
                feeds = data.feeds;
                columns = data.columns;
                settings = data.settings;
                persistAccountState();
                writeColumnIds(data.columnIds);
                location.reload();
            } catch(e) {
                alert("Error parsing file");
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function cleanUp() {
    let ids = columnIdsOfActive();
    for(let columnId in columns) {
        if(!ids.includes(columnId)) {
            delete columns[columnId];
        }
    }
    const columnsJson = JSON.stringify(columns);
    const columnsKey = activeAccountId ? stateKey("columns", activeAccountId) : "OTDcolumns";
    localStorage[columnsKey] = columnsJson;
    for(let id in feeds) {
        if(!columnsJson.includes(id)) {
            delete feeds[id];
        }
    }
    const feedsKey = activeAccountId ? stateKey("feeds", activeAccountId) : "OTDfeeds";
    localStorage[feedsKey] = JSON.stringify(feeds);
}

function getFollows(id = getCurrentUserId(), cursor = -1, count = 5000) {
	return new Promise(function (resolve, reject) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", `https://api.${location.hostname}/1.1/friends/ids.json?user_id=${id}&cursor=${cursor}&stringify_ids=true&count=${count}`, true);
		xhr.setRequestHeader("X-Twitter-Active-User", "yes");
		xhr.setRequestHeader("X-Twitter-Auth-Type", "OAuth2Session");
		xhr.setRequestHeader("X-Twitter-Client-Language", "en");
		xhr.setRequestHeader("Authorization", "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA");
		xhr.setRequestHeader("X-Csrf-Token", (function () {
			var csrf = document.cookie.match(/(?:^|;\s*)ct0=([0-9a-f]+)\s*(?:;|$)/);
			return csrf ? csrf[1] : "";
		})());
		xhr.withCredentials = true;

		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4 && xhr.status === 200) {
				resolve(JSON.parse(xhr.responseText));
			} else if (xhr.readyState === 4 && xhr.status !== 200) {
                reject(xhr);
            }
		};
		
		xhr.send();
	});
}

let followsData = JSON.parse(localStorage.OTDfollowsData || "{}");

let updatingFollows = false;
function updateFollows(id = getCurrentUserId()) {
    if(followsData[id] && followsData[id].lastUpdate && Date.now() - +followsData[id].lastUpdate < 1000 * 60 * 60 * 6) return;
    if(updatingFollows) return;
    updatingFollows = true;

    if(!followsData[id]) followsData[id] = {};
    let newfollows = [];
    let cursor = -1;
    let count = 5000;
    let i = 0;
    let get = async () => {
        let res = await getFollows(id, cursor, count);
        newfollows = newfollows.concat(res.ids);
        if(res.next_cursor_str === "0" || i++ > 10) {
            followsData[id].lastUpdate = Date.now();
            followsData[id].data = newfollows;
            localStorage.OTDfollowsData = JSON.stringify(followsData);
            updatingFollows = false;
            return;
        }
        cursor = res.next_cursor_str;
        get();
    };

    get();
}

// setTimeout(updateFollows, 1000);
// setInterval(updateFollows, 1000 * 60);

function parseNoteTweet(result) {
    let text, entities;
    if (result.note_tweet.note_tweet_results.result) {
        text = result.note_tweet.note_tweet_results.result.text;
        entities = result.note_tweet.note_tweet_results.result.entity_set;
        if (result.note_tweet.note_tweet_results.result.richtext?.richtext_tags.length) {
            entities.richtext = result.note_tweet.note_tweet_results.result.richtext.richtext_tags; // logically, richtext is an entity, right?
        }
    } else {
        text = result.note_tweet.note_tweet_results.text;
        entities = result.note_tweet.note_tweet_results.entity_set;
    }
    return { text, entities };
}

function parseTweetCard(card) {
    const legacy = card?.legacy;
    if (!legacy) return;
    const bindings = Array.isArray(legacy.binding_values)
        ? Object.fromEntries(legacy.binding_values.filter(entry => entry?.key && entry.value).map(entry => [entry.key, entry.value]))
        : legacy.binding_values || {};
    const normalized = { ...legacy, binding_values: bindings };
    if (legacy.name !== "unified_card") return normalized;
    try {
        const payload = JSON.parse(bindings.unified_card?.string_value);
        if (!["image_website", "image_carousel_website", "image_multi_dest_carousel_website", "image_collection_website"].includes(payload?.type)) return normalized;
        const objects = payload.component_objects || {};
        const slides = payload.layout?.data?.slides;
        const order = Array.isArray(slides) && slides.length
            ? slides.flat()
            : payload.components;
        if (!Array.isArray(order)) return normalized;
        const mediaKey = order.find(key => ["media", "swipeable_media"].includes(objects[key]?.type));
        const component = objects[mediaKey];
        const slot = component?.type === "swipeable_media" ? component.data?.media_list?.[0] : component?.data;
        const media = payload.media_entities?.[slot?.id];
        if (media?.type !== "photo") return normalized;
        const imageUrl = media.media_url_https || media.media_url;
        const image = new URL(imageUrl);
        if (!["https:", "http:"].includes(image.protocol)) return normalized;
        const slide = Array.isArray(slides) ? slides.find(keys => Array.isArray(keys) && keys.includes(mediaKey)) : null;
        const details = (slide || order).map(key => objects[key]).find(value => value?.type === "details")?.data;
        const destinationKey = slot?.destination || component?.data?.destination || details?.destination;
        const destination = payload.destination_objects?.[destinationKey];
        if (!["browser", "browser_with_docked_media"].includes(destination?.type)) return normalized;
        const urlData = destination.data?.url_data;
        const url = new URL(urlData?.url);
        if (!["https:", "http:"].includes(url.protocol)) return normalized;
        const vanity = typeof urlData.vanity === "string" && urlData.vanity ? urlData.vanity : url.hostname;
        const stringValue = value => ({ type: "STRING", string_value: value });
        const converted = {
            card_url: stringValue(urlData.url),
            title: stringValue(typeof details?.title?.content === "string" && details.title.content ? details.title.content : vanity),
            description: stringValue(typeof details?.subtitle?.content === "string" ? details.subtitle.content : ""),
            domain: stringValue(vanity),
            vanity_url: stringValue(vanity),
        };
        for (const prefix of ["photo_image_full_size", "summary_photo_image", "thumbnail_image"]) {
            for (const [suffix, bucket] of [["", "medium"], ["_small", "small"], ["_large", "large"], ["_x_large", "large"], ["_original", "original"]]) {
                const sizes = media.sizes || {};
                const size = sizes[bucket] || sizes.medium || sizes.large || {};
                const width = bucket === "original" ? media.original_info?.width || sizes.large?.w || 0 : size.w || 0;
                const height = bucket === "original" ? media.original_info?.height || sizes.large?.h || 0 : size.h || 0;
                converted[prefix + suffix] = { type: "IMAGE", image_value: { url: imageUrl, width, height } };
            }
        }
        return { ...legacy, name: "summary_large_image", url: urlData.url, binding_values: converted };
    } catch {
        return normalized;
    }
}

// parseTweet throws on shapes it can't handle. Timelines must drop that one tweet rather
// than fail the whole response, which TweetDeck shows as an empty "No recent Tweets" column.
function safeParseTweet(res, options) {
    try {
        return parseTweet(res, options);
    } catch (e) {
        return undefined;
    }
}

function userHidden(user) {
    return !!(user && (user.muting || user.blocking));
}

// Drop a tweet whose author, or the author of a retweet, is muted or blocked.
// A quote of such a user loses the quoted tweet and keeps the outer one.
function tweetHidden(tweet) {
    if (!tweet) return false;
    if (userHidden(tweet.user) || userHidden(tweet.retweeted_status?.user)) return true;
    if (userHidden(tweet.quoted_status?.user)) {
        delete tweet.quoted_status;
        tweet.is_quote_status = false;
    }
    if (userHidden(tweet.retweeted_status?.quoted_status?.user)) {
        delete tweet.retweeted_status.quoted_status;
    }
    return false;
}

function isPromoted(entry) {
    const id = entry?.entryId || "";
    if (id.includes("promoted")) return true;
    const itemContent = entry?.content?.itemContent || entry?.item?.itemContent;
    return !!itemContent?.promotedMetadata;
}

// A video unified card has no legacy card TweetDeck can play. Hand it the same
// media object a native video tweet carries, and the column player uses it.
function mediaFromUnifiedCard(card) {
    const legacy = card?.legacy;
    if (!legacy || legacy.name !== "unified_card") return null;
    const bindings = Array.isArray(legacy.binding_values)
        ? Object.fromEntries(legacy.binding_values.filter(entry => entry?.key && entry.value).map(entry => [entry.key, entry.value]))
        : legacy.binding_values || {};
    let payload;
    try {
        payload = JSON.parse(bindings.unified_card?.string_value);
    } catch (e) {
        return null;
    }
    const objects = payload?.component_objects || {};
    const slides = payload?.layout?.data?.slides;
    const order = Array.isArray(slides) && slides.length ? slides.flat() : payload?.components;
    if (!Array.isArray(order)) return null;
    const mediaKey = order.find(key => ["media", "swipeable_media"].includes(objects[key]?.type));
    const component = objects[mediaKey];
    const slot = component?.type === "swipeable_media" ? component.data?.media_list?.[0] : component?.data;
    const media = payload.media_entities?.[slot?.id];
    if (!media || (media.type !== "video" && media.type !== "animated_gif")) return null;
    const variants = media.video_info?.variants;
    if (!Array.isArray(variants) || !variants.some(variant => variant?.content_type === "video/mp4" && variant.url)) return null;
    return {
        id_str: String(media.id_str || media.id || slot.id),
        media_url_https: media.media_url_https || media.media_url,
        type: media.type,
        sizes: media.sizes || {},
        video_info: media.video_info,
        original_info: media.original_info,
    };
}

function presentCard(tweet, card) {
    if (!tweet || !card) return;
    const media = mediaFromUnifiedCard(card);
    if (media) {
        if (!tweet.extended_entities?.media?.length) tweet.extended_entities = { media: [media] };
        return;
    }
    const parsed = parseTweetCard(card);
    if (parsed) tweet.card = parsed;
}

function parseTweet(res, options) {
    const expandNotes = options?.expandNotes ?? localStorage.OTDenableAutoExpand === "1";
    try {

        if (typeof res !== "object") return;
        if (res.limitedActionResults) {
            let limitation = res.limitedActionResults.limited_actions.find((l) => l.action === "Reply");
            if (limitation) {
                res.tweet.legacy.limited_actions_text = limitation.prompt
                    ? limitation.prompt.subtext.text
                    : "This tweet has limitations to who can reply.";
            }
            res = res.tweet;
        }
        if (!res.legacy && res.tweet) res = res.tweet;
        let tweet = res.legacy;
        if (!res.core || !tweet) return;
        if(!tweet.id) {
            tweet.id = +tweet.id_str;
        }
        // Suspended or deleted authors come back as `user_results: {}`. Without an author the
        // tweet can't be rendered, so skip it instead of throwing and failing the whole feed.
        let result = res.core.user_results?.result;
        if (!result) return;
        tweet.conversation_id = +tweet.conversation_id_str;
        tweet.text = tweet.full_text;
        // X is migrating user fields out of `legacy` into `core`/`avatar`/etc,
        // so `legacy` can now be missing entirely. The fallbacks below already
        // repopulate name/screen_name/avatar/created_at from the new shape.
        tweet.user = result.legacy || {};
        tweet.user.id = +tweet.user_id_str;
        tweet.user.id_str = tweet.user_id_str;
        if (result.is_blue_verified) {
            tweet.user.verified = true;
            tweet.user.verified_type = "Blue";
        }
        if(!tweet.user.profile_image_url && result?.avatar?.image_url) {
            tweet.user.profile_image_url = result.avatar.image_url;
            tweet.user.profile_image_url_https = tweet.user.profile_image_url.replace("http://", "https://");
        }
        if(!tweet.user.profile_image_url && tweet.user.profile_image_url_https) {
            tweet.user.profile_image_url = tweet.user.profile_image_url_https.replace("https://", "http://");
        }
        if(!tweet.user.name && result?.core?.name) {
            tweet.user.name = result.core.name;
        }
        if(!tweet.user.screen_name && result?.core?.screen_name) {
            tweet.user.screen_name = result.core.screen_name;
        }
        if(!tweet.user.created_at && result?.core?.created_at) {
            tweet.user.created_at = result.core.created_at;
        }
        if(result?.relationship_perspectives?.muting) {
            tweet.user.muting = true;
        }
        if(result?.relationship_perspectives?.blocking) {
            tweet.user.blocking = true;
        }
        if(result?.privacy?.protected) {
            tweet.user.protected = true;
        }
        if(result?.location?.location) {
            tweet.user.location = res.core.user_results.result.location.location;
        }
        if(result?.verification?.verified) {
            tweet.user.verified = true;
        }

        if (tweet.retweeted_status_result?.result) {
            let result = tweet.retweeted_status_result.result;
            if (result.limitedActionResults) {
                let limitation = result.limitedActionResults.limited_actions.find(
                    (l) => l.action === "Reply"
                );
                if (limitation && result.tweet?.legacy) {
                    result.tweet.legacy.limited_actions_text = limitation.prompt
                        ? limitation.prompt.subtext.text
                        : "This tweet has limitations to who can reply.";
                }
            }
            // TweetWithVisibilityResults (mediaVisibilityResults, tweetInterstitial, ...) wraps the
            // real tweet in `tweet`, with or without limitedActionResults. Without unwrapping it,
            // retweeted_status stays undefined and TweetDeck falls back to the raw "RT @user:" text.
            if (!result.legacy && result.tweet) result = result.tweet;
            if (
                result.quoted_status_result &&
                result.quoted_status_result.result &&
                result.quoted_status_result.result.legacy &&
                result.quoted_status_result.result.core?.user_results?.result
            ) {
                result.legacy.quoted_status = result.quoted_status_result.result.legacy;
                presentCard(result.legacy.quoted_status, result.quoted_status_result.result.card);
                result.legacy.quoted_status.id = +result.legacy.quoted_status.id_str;
                result.legacy.quoted_status.text = result.legacy.quoted_status.full_text;
                result.legacy.quoted_status.conversation_id = +result.legacy.quoted_status.conversation_id_str;
                if (result.legacy.quoted_status) {
                    result.legacy.quoted_status.user =
                        result.quoted_status_result.result.core.user_results.result.legacy || {};
                    result.legacy.quoted_status.user.id_str = result.legacy.quoted_status.user_id_str;
                    result.legacy.quoted_status.user.id = +result.legacy.quoted_status.user_id_str;
                    let user_result = result?.quoted_status_result?.result?.core?.user_results?.result;
                    if(!result.legacy.quoted_status.user.profile_image_url && user_result?.avatar?.image_url) {
                        result.legacy.quoted_status.user.profile_image_url = user_result.avatar.image_url;
                        result.legacy.quoted_status.user.profile_image_url_https = result.legacy.quoted_status.user.profile_image_url.replace("http://", "https://");
                    }
                    if(!result.legacy.quoted_status.user.profile_image_url && result.legacy.quoted_status.user.profile_image_url_https) {
                        result.legacy.quoted_status.user.profile_image_url = result.legacy.quoted_status.user.profile_image_url_https.replace("https://", "http://");
                    }
                    if(!result.legacy.quoted_status.user.name && user_result?.core?.name) {
                        result.legacy.quoted_status.user.name = user_result.core.name;
                    }
                    if(!result.legacy.quoted_status.user.screen_name && user_result?.core?.screen_name) {
                        result.legacy.quoted_status.user.screen_name = user_result.core.screen_name;
                    }
                    if(!result.legacy.quoted_status.user.created_at && user_result?.core?.created_at) {
                        result.legacy.quoted_status.user.created_at = user_result.core.created_at;
                    }
                    if(user_result?.relationship_perspectives?.muting) {
                        result.legacy.quoted_status.user.muting = true;
                    }
                    if(user_result?.relationship_perspectives?.blocking) {
                        result.legacy.quoted_status.user.blocking = true;
                    }
                    if(user_result?.privacy?.protected) {
                        result.legacy.quoted_status.user.protected = true;
                    }
                    if(user_result?.location?.location) {
                        result.legacy.quoted_status.user.location = user_result.location.location;
                    }
                    if(user_result?.verification?.verified) {
                        result.legacy.quoted_status.user.verified = true;
                    }
                    
                    if (user_result.is_blue_verified) {
                        result.legacy.quoted_status.user.verified = true;
                        result.legacy.quoted_status.user.verified_type = "Blue";
                    }
                } else {
                    console.warn("No retweeted quoted status", result);
                }
            }
            tweet.retweeted_status = result.legacy;
            if (tweet.retweeted_status && result.core?.user_results?.result) {
                let user_result = result.core.user_results.result;
                tweet.retweeted_status.text = tweet.retweeted_status.full_text;
                tweet.retweeted_status.id = +tweet.retweeted_status.id_str;
                tweet.retweeted_status.conversation_id = +tweet.retweeted_status.conversation_id_str;
                // Same migration as the top-level tweet: user fields may live in core/avatar instead of legacy.
                tweet.retweeted_status.user = user_result.legacy || {};
                tweet.retweeted_status.user.id_str = tweet.retweeted_status.user_id_str;
                tweet.retweeted_status.user.id = +tweet.retweeted_status.user_id_str;
                if(!tweet.retweeted_status.user.profile_image_url && user_result?.avatar?.image_url) {
                    tweet.retweeted_status.user.profile_image_url = user_result.avatar.image_url;
                    tweet.retweeted_status.user.profile_image_url_https = tweet.retweeted_status.user.profile_image_url.replace("http://", "https://");
                } 
                if(!tweet.retweeted_status.user.profile_image_url && tweet.retweeted_status.user.profile_image_url_https) {
                    tweet.retweeted_status.user.profile_image_url = tweet.retweeted_status.user.profile_image_url_https.replace("https://", "http://");
                }
                if(!tweet.retweeted_status.user.name && user_result?.core?.name) {
                    tweet.retweeted_status.user.name = user_result.core.name;
                }
                if(!tweet.retweeted_status.user.screen_name && user_result?.core?.screen_name) {
                    tweet.retweeted_status.user.screen_name = user_result.core.screen_name;
                }
                if(!tweet.retweeted_status.user.created_at && user_result?.core?.created_at) {
                    tweet.retweeted_status.user.created_at = user_result.core.created_at;
                }
                if(user_result?.relationship_perspectives?.muting) {
                    tweet.retweeted_status.user.muting = true;
                }
                if(user_result?.relationship_perspectives?.blocking) {
                    tweet.retweeted_status.user.blocking = true;
                }
                if(user_result?.privacy?.protected) {
                    tweet.retweeted_status.user.protected = true;
                }
                if(user_result?.location?.location) {
                    tweet.retweeted_status.user.location = result.core.user_results.result.location.location;
                }
                if(user_result?.verification?.verified) {
                    tweet.retweeted_status.user.verified = true;
                }

                if (result.core.user_results.result.is_blue_verified) {
                    tweet.retweeted_status.user.verified = true;
                    tweet.retweeted_status.user.verified_type = "Blue";
                }
                tweet.retweeted_status.ext = {};
                if (result.views) {
                    tweet.retweeted_status.ext.views = { r: { ok: { count: +result.views.count } } };
                }
                presentCard(tweet.retweeted_status, result.card);
            } else {
                console.warn("No retweeted status", result);
            }
            // With autoexpand off, leave the truncated text. It ends in "…" and
            // TweetDeck adds an Expand tweet link. statuses/show passes expandNotes.
            if (expandNotes && result.note_tweet && result.note_tweet.note_tweet_results) {
                let note = parseNoteTweet(result);
                tweet.retweeted_status.full_text = note.text;
                tweet.retweeted_status.text = note.text;
                tweet.retweeted_status.entities = note.entities;
                tweet.retweeted_status.display_text_range = undefined; // no text range for long tweets
            }
        }
    
        if (res.quoted_status_result) {
            tweet.quoted_status_result = res.quoted_status_result;
        }
        if (expandNotes && res.note_tweet && res.note_tweet.note_tweet_results) {
            let note = parseNoteTweet(res);
            tweet.full_text = note.text;
            tweet.text = note.text;
            tweet.entities = note.entities;
            tweet.display_text_range = undefined; // no text range for long tweets
        }
        if (tweet.quoted_status_result && tweet.quoted_status_result.result) {
            let result = tweet.quoted_status_result.result;
            if (!result.core && result.tweet) result = result.tweet;
            if (result.limitedActionResults) {
                let limitation = result.limitedActionResults.limited_actions.find(
                    (l) => l.action === "Reply"
                );
                if (limitation) {
                    result.tweet.legacy.limited_actions_text = limitation.prompt
                        ? limitation.prompt.subtext.text
                        : "This tweet has limitations to who can reply.";
                }
                result = result.tweet;
            }
            if(result && result.legacy) {
                tweet.quoted_status = result.legacy;
                presentCard(tweet.quoted_status, result.card);
                tweet.quoted_status.id = +tweet.quoted_status.id_str;
                tweet.quoted_status.conversation_id = +tweet.quoted_status.conversation_id_str;
                tweet.quoted_status.text = tweet.quoted_status.full_text;
                if (tweet.quoted_status) {
                    let user_result = result.core?.user_results?.result;
                    // Same migration as above: the author may have no `legacy` but still have core/avatar.
                    tweet.quoted_status.user = user_result ? (user_result.legacy || {}) : undefined;
                    if (!tweet.quoted_status.user) {
                        delete tweet.quoted_status;
                    } else {
                        tweet.quoted_status.user.id_str = tweet.quoted_status.user_id_str;
                        tweet.quoted_status.user.id = +tweet.quoted_status.user_id_str;
                        if(!tweet.quoted_status.user.profile_image_url && user_result?.avatar?.image_url) {
                            tweet.quoted_status.user.profile_image_url = user_result.avatar.image_url;
                            tweet.quoted_status.user.profile_image_url_https = tweet.quoted_status.user.profile_image_url.replace("http://", "https://");
                        }
                        if(!tweet.quoted_status.user.profile_image_url && tweet.quoted_status.user.profile_image_url_https) {
                            tweet.quoted_status.user.profile_image_url = tweet.quoted_status.user.profile_image_url_https.replace("https://", "http://");
                        }
                        if(!tweet.quoted_status.user.name && user_result?.core?.name) {
                            tweet.quoted_status.user.name = user_result.core.name;
                        }
                        if(!tweet.quoted_status.user.screen_name && user_result?.core?.screen_name) {
                            tweet.quoted_status.user.screen_name = user_result.core.screen_name;
                        }
                        if(!tweet.quoted_status.user.created_at && user_result?.core?.created_at) {
                            tweet.quoted_status.user.created_at = user_result.core.created_at;
                        }
                        if(user_result?.relationship_perspectives?.muting) {
                            tweet.quoted_status.user.muting = true;
                        }
                        if(user_result?.relationship_perspectives?.blocking) {
                            tweet.quoted_status.user.blocking = true;
                        }
                        if(user_result?.privacy?.protected) {
                            tweet.quoted_status.user.protected = true;
                        }
                        if(user_result?.location?.location) {
                            tweet.quoted_status.user.location = user_result.location.location;
                        }
                        if(user_result?.verification?.verified) {
                            tweet.quoted_status.user.verified = true;
                        }
                        if (user_result.is_blue_verified) {
                            tweet.quoted_status.user.verified = true;
                            tweet.quoted_status.user.verified_type = "Blue";
                        }
                        tweet.quoted_status.ext = {};
                        if (result.views) {
                            tweet.quoted_status.ext.views = { r: { ok: { count: +result.views.count } } };
                        }
                    }
                } else {
                    console.warn("No quoted status", result);
                }
            }
        }
        presentCard(tweet, res.card);
        if (res.views) {
            if (!tweet.ext) tweet.ext = {};
            tweet.ext.views = { r: { ok: { count: +res.views.count } } };
        }
        if (res.source) {
            tweet.source = res.source;
        }
        if (res.birdwatch_pivot) {
            // community notes
            tweet.birdwatch = res.birdwatch_pivot;
        }
    
        if (tweet.favorited && tweet.favorite_count === 0) {
            tweet.favorite_count = 1;
        }
        if (tweet.retweeted && tweet.retweet_count === 0) {
            tweet.retweet_count = 1;
        }
    
        return tweet;
    } catch (e) {
        console.error('error parsing tweet', e, res);
        throw new Error('error parsing tweet');
    }
}

// Legacy TweetDeck polled REST with `since_id` set to its second-newest tweet, so every page
// overlapped the newest cached tweet and FeedPoller could tell a real gap from "nothing new".
// Our cursor-based polls only return entries above the previous page, so every non-empty poll
// looked like a gap: FeedPoller.forgetAll() wiped its cache, and anything that refills columns
// from that cache (theme, font size, column width and sensitive-media toggles) came back with
// only the last poll's tweets. Treat a page as covering everything above the lower bound it was
// asked for, which is what REST guaranteed.
let legacyPollerPatched = false;
function keepLegacyPollerCache() {
    if (legacyPollerPatched) return;
    try {
        const poller = TD.util.poller;
        const original = poller.makeRequestResultInterval;
        poller.makeRequestResultInterval = function (chirps, requested) {
            const covered = original.call(this, chirps, requested);
            if (covered.empty || !requested.from.finite) return covered;
            return covered.hull(new requested.constructor(requested.from, requested.to));
        };
        legacyPollerPatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// ---- request plumbing shared by the timeline routes -------------------------------------------

function getRequestHeader(xhr, name) {
    const headers = xhr.modReqHeaders || {};
    const wanted = name.toLowerCase();
    for (const key in headers) {
        if (key.toLowerCase() === wanted) return headers[key];
    }
    return undefined;
}

// Which account a legacy request acts for. Teams accounts arrive as an x-act-as-user-id header
// that legacy only adds after open() (TD.net.ajax's beforeSend in bundle.js), so this is only
// reliable from the Proxy's send() onwards; a request without the header is the login account.
function requestUserId(xhr) {
    const acting = getRequestHeader(xhr, "x-act-as-user-id");
    if (acting) return String(acting);
    if (xhr.storage && xhr.storage.user_id) return String(xhr.storage.user_id);
    try {
        const id = TD.storage.store.getTwitterLoginAccount()?.getUserID();
        if (id) return String(id);
    } catch (e) {
        // no legacy store yet
    }
    try {
        return getCurrentUserId();
    } catch (e) {
        return verifiedUser?.id_str ?? localStorage.twitterAccountID;
    }
}

// Routes whose URL depends on the request headers defer the real open() to beforeSend.
function deferOpen(xhr, method, url, async, username, password) {
    xhr.storage.open = { method, async, username, password };
}

function openDeferred(xhr) {
    const open = xhr.storage.open || { method: xhr.modMethod || "GET" };
    xhr.open(open.method, xhr.modUrl, open.async ?? true, open.username ?? null, open.password ?? null);
}

// Answer legacy with a failed request without touching the network. Its error path neither
// retries nor marks the feed as exhausted, unlike an empty 200.
function failWithoutRequest(xhr, reason) {
    console.warn(`OldTweetDeck: ${reason}`);
    xhr.storage.cancelled = true;
    xhr._status = 503;
    xhr._statusText = reason;
}

// Legacy reads `status` before `responseText`, so a 200 whose body is only a GraphQL error would
// reach FeedPoller as an empty page (which can end infinite scroll). The Proxy runs this once on
// the first read of either, so the page can be failed instead; the parsed body is kept for
// afterRequest.
function graphqlPageInspector(timelineOf) {
    return (xhr) => {
        if (xhr.status < 200 || xhr.status >= 300) return;
        let data;
        try {
            data = JSON.parse(xhr.responseText);
        } catch (e) {
            return;
        }
        xhr.storage.parsed = data;
        if (!timelineOf(data)) {
            console.warn("OldTweetDeck: GraphQL error page", data?.errors ?? data);
            xhr._status = 503;
            xhr._statusText = "GraphQL error";
            xhr.storage.failure = { kind: "x-error", status: null, detail: data?.errors?.[0]?.message || "GraphQL error" };
        }
    };
}

// ---- telling the user why requests fail -------------------------------------------------------

// Legacy shows nothing when a column's request fails. At startup it shows "Error initializing
// TweetDeck" or a bare login form, and a request that never finishes leaves the spinner up for
// good. Remember why requests failed. Before TweetDeck is ready, put that on the login form or
// the loading screen. After that, raise a toast, at most once per reason and column type.
const REQUEST_LABELS = {
    "/1.1/account/verify_credentials.json": "account verification",
    "/1.1/users/contributees.json": "linked accounts",
    "/1.1/tweetdeck/clients/blackbird/all": "your saved columns",
    "/1.1/statuses/home_timeline.json": "Home",
    "/1.1/lists/statuses.json": "List columns",
    "/1.1/statuses/user_timeline.json": "User columns",
    "/1.1/statuses/bookmarks.json": "Bookmarks",
    "/1.1/activity/about_me.json": "Notifications",
    "/1.1/statuses/mentions_timeline.json": "Mentions",
    "/1.1/favorites/list.json": "Likes",
    "/1.1/search/universal.json": "Search",
};
// 401 and 403 stay off the toasts: after startup they also answer protected or missing accounts.
const TOASTED_FAILURES = new Set(["rate-limit", "x-error", "solver", "unreadable"]);
const FAILURE_NOTICE_INTERVAL = 5 * 60 * 1000;
const STARTUP_STALL_DELAY = 30 * 1000;
const startupFailures = [];
const startupRequests = [];
const failureNoticeUntil = new Map();
let loginMessagePatched = false;
let startupWatch = null;

function legacyReady() {
    return typeof TD !== "undefined" && TD.ready === true;
}

function requestLabel(path) {
    if (REQUEST_LABELS[path]) return REQUEST_LABELS[path];
    if (/^\/2\/timeline\/conversation\//.test(path)) return "a conversation";
    return null;
}

function requestPath(xhr) {
    try {
        return new URL(xhr.originalUrl || xhr.modUrl).pathname;
    } catch (e) {
        return "";
    }
}

function formatClock(time) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function describeFailure(f) {
    switch (f.kind) {
        case "rate-limit":
            return `X is rate limiting ${f.label} (429). ` + (f.resetAt
                ? `It should work again after ${formatClock(f.resetAt)}.`
                : "Wait a few minutes before reloading.");
        case "session":
            return `X refused ${f.label} (${f.status}). Check that you are logged in at x.com, then reload TweetDeck.`;
        case "solver":
            return `Could not sign the request for ${f.label} (${f.detail}). Reload TweetDeck. If this keeps happening, the challenge solver may need an update.`;
        case "unreadable":
            return `X sent a response for ${f.label} that OldTweetDeck could not read.`;
        case "network":
            return `Could not reach X for ${f.label}. Check your connection, then reload TweetDeck.`;
        case "verification-timeout":
            return "X did not confirm your account within 20 seconds. Reload TweetDeck.";
        default: {
            const detail = [f.status, f.detail].filter(Boolean).join(": ");
            return `X returned an error for ${f.label}${detail ? ` (${detail})` : ""}.`;
        }
    }
}

// A finished request's status as legacy sees it, or nothing when it worked. A request this file
// answered itself (no cursor yet, and so on) is not a problem unless it says why it failed.
function failureFromStatus(xhr) {
    const status = xhr._status || xhr.status;
    if ((status >= 200 && status < 300) || status === 304) return null;
    if (xhr.storage?.failure) return Object.assign({ status }, xhr.storage.failure);
    if (xhr.storage?.cancelled) return null;
    if (status === 429) {
        const reset = Number(xhr.getResponseHeader?.("x-rate-limit-reset"));
        return { kind: "rate-limit", status, resetAt: reset > 0 ? reset * 1000 : null };
    }
    if (status === 401 || status === 403) return { kind: "session", status };
    if (status === 0) return { kind: "network", status };
    // 400 and 404 on a timeline usually mean X retired the GraphQL query id it uses.
    if (status >= 500 || status === 400 || status === 404) return { kind: "x-error", status, detail: xhr.statusText || "" };
    return null;
}

// Only the requests in REQUEST_LABELS are reported: startup depends on the first three, and the
// rest feed columns. Legacy reports failed actions such as a like or a reply itself.
function noteRequestFailure(xhr, failure) {
    if (!failure || xhr._failureNoted) return;
    xhr._failureNoted = true;
    const label = requestLabel(requestPath(xhr));
    if (!label) return;
    const notice = Object.assign({ label }, failure);
    if (!legacyReady()) {
        const same = startupFailures.findIndex((f) => f.kind === notice.kind && f.label === notice.label);
        if (same >= 0) startupFailures.splice(same, 1);
        startupFailures.push(notice);
        if (startupFailures.length > 3) startupFailures.shift();
        explainStartupFailures();
        return;
    }
    const method = String(xhr.modMethod || "GET").toUpperCase();
    if (method !== "GET" || !TOASTED_FAILURES.has(notice.kind)) return;
    const key = `${notice.kind}:${notice.label}`;
    const now = Date.now();
    if (now < (failureNoticeUntil.get(key) ?? 0)) return;
    failureNoticeUntil.set(key, Math.max(now + FAILURE_NOTICE_INTERVAL, notice.resetAt || 0));
    try {
        globalThis.toasts.showErrorNotification({ message: describeFailure(notice), timeoutDelayMs: 15000 });
    } catch (e) {
        console.warn("OldTweetDeck:", describeFailure(notice));
    }
}

// Legacy ends a failed startup in TD.controller.init.showLogin(message), with a message that
// does not say what failed, or none at all for 401 and 403.
function explainStartupFailures() {
    if (loginMessagePatched) return;
    try {
        const init = TD.controller.init;
        const showLogin = init.showLogin;
        if (typeof showLogin !== "function") return;
        init.showLogin = function (message) {
            const reasons = startupFailures.map(describeFailure).join(" ");
            return showLogin.call(this, reasons ? `TweetDeck could not start. ${reasons}` : message);
        };
        loginMessagePatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next failure tries again.
    }
}

function rememberStartupRequest(xhr) {
    if (legacyReady()) return;
    startupRequests.push({ xhr, since: Date.now() });
    if (startupRequests.length > 50) startupRequests.shift();
}

function startupStatusText(now = Date.now()) {
    if (startupFailures.length) {
        return `TweetDeck has not loaded. ${startupFailures.map(describeFailure).join(" ")}`;
    }
    const waiting = startupRequests.find(
        (r) => !r.xhr.storage?.cancelled && r.xhr.readyState !== 4 && r.xhr._readyState !== 4
    );
    if (waiting) {
        const path = requestPath(waiting.xhr);
        const seconds = Math.round((now - waiting.since) / 1000);
        return `TweetDeck is still waiting for X to answer ${requestLabel(path) || path} (${seconds} s).`;
    }
    return "TweetDeck is taking longer than usual to load.";
}

// Under the startup spinner, once it has been up for a while. The login form replaces the
// spinner's container when startup fails, and carries its own message: then this returns false.
function renderStartupStatus() {
    const container = document.querySelector(".js-app-loading .js-signin-ui");
    if (!container || !container.querySelector(".spinner-centered")) return false;
    let line = container.querySelector(".otd-startup-status");
    if (!line) {
        line = document.createElement("p");
        line.className = "otd-startup-status";
        line.style.cssText = "margin: 16px auto 0; max-width: 420px; line-height: 1.5;";
        container.appendChild(line);
    }
    line.textContent = startupStatusText() + " ";
    const reload = document.createElement("a");
    reload.href = "#";
    reload.textContent = "Reload";
    reload.addEventListener("click", (e) => {
        e.preventDefault();
        location.reload();
    });
    line.appendChild(reload);
    return true;
}

function watchStartup() {
    if (startupWatch || typeof document === "undefined") return;
    startupWatch = setTimeout(function check() {
        if (legacyReady()) return;
        try {
            if (!renderStartupStatus()) return;
        } catch (e) {
            console.error(e);
            return;
        }
        startupWatch = setTimeout(check, 5000);
    }, STARTUP_STALL_DELAY);
}

// ---- timeline pages and cursors ---------------------------------------------------------------

// One record per page a timeline route handed to legacy: the ids it contained and the cursors X
// returned with it. Legacy derives max_id / since_id from whichever chirp sits at the edge of its
// column, so every id of a page has to resolve to that page's cursors, not just the one at the end.
const TIMELINE_PAGE_LIMIT = 300;
const timelinePages = new Map();

function rememberTimelinePage(feedKey, tweets, bottom, top) {
    if (!tweets.length || (!bottom && !top)) return;
    let pages = timelinePages.get(feedKey);
    if (!pages) timelinePages.set(feedKey, (pages = []));
    pages.push({ ids: new Set(tweets.map((t) => t.id_str)), bottom, top });
    if (pages.length > TIMELINE_PAGE_LIMIT) pages.splice(0, pages.length - TIMELINE_PAGE_LIMIT);
}

function timelinePageOf(feedKey, tweetId) {
    const pages = timelinePages.get(feedKey);
    if (!pages) return undefined;
    for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i].ids.has(tweetId)) return pages[i];
    }
    return undefined;
}

function timelineCursor(feedKey, tweetId, edge) {
    return timelinePageOf(feedKey, tweetId)?.[edge];
}

// The page below `tweetId` came back with nothing usable: point at the page after it, so the next
// request for the same bound goes deeper instead of fetching the same page again.
function advanceTimelineCursor(feedKey, tweetId, bottom) {
    const page = timelinePageOf(feedKey, tweetId);
    if (page && bottom) page.bottom = bottom;
}

function findCursor(entries, edge) {
    const entry = entries.find(
        (e) => e.entryId.startsWith(`sq-cursor-${edge}-`) || e.entryId.startsWith(`cursor-${edge}-`)
    );
    return entry?.content?.value ?? entry?.content?.operation?.cursor?.value;
}

// Legacy sorts a column by `receiveTime || id` (TwitterStatus.fromJSONObject in bundle.js). A
// conversation module carries the older tweets a reply answers. At their own ids those can sink
// below the page and become the column's bottom chirp, the one legacy turns into max_id for infinite
// scroll, after which every page below is discarded as "too new"; sorted up to the reply instead,
// they show old tweets out of order. So keep each module's newest tweet, and an older one only where
// the page itself reaches back that far and, for a poll, only past what the column already has.
function threadTweetsInRange(standalone, threads, since_id) {
    if (!threads.length) return [];
    const heads = threads.map(newestTweet);
    let floor;
    for (const tweet of [...standalone, ...heads]) {
        const id = BigInt(tweet.id_str);
        if (floor === undefined || id < floor) floor = id;
    }
    if (since_id && BigInt(since_id) >= floor) floor = BigInt(since_id) + 1n;
    const kept = [];
    threads.forEach((thread, i) => {
        for (const tweet of thread) {
            if (tweet === heads[i] || BigInt(tweet.id_str) >= floor) kept.push(tweet);
        }
    });
    return kept;
}

function newestTweet(thread) {
    return thread.reduce((a, b) => (compareIds(b.id_str, a.id_str) > 0 ? b : a));
}

function compareIds(a, b) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

function sortNewestFirst(tweets) {
    return tweets.sort((a, b) => compareIds(b.id_str, a.id_str));
}

// true when `id` is new for this account's Home feed; the set stays bounded.
const SEEN_HOME_TWEET_LIMIT = 2000;
function rememberHomeTweet(user_id, id) {
    let seen = seenHomeTweets[user_id];
    if (!(seen instanceof Set)) seen = seenHomeTweets[user_id] = new Set();
    if (seen.has(id)) return false;
    seen.add(id);
    while (seen.size > SEEN_HOME_TWEET_LIMIT) {
        seen.delete(seen.values().next().value);
    }
    return true;
}

// A cursor-top poll only returns what X files above that cursor. Every so often poll the top of
// the timeline without a cursor instead, so a stale cursor (or anything X skipped) can't keep a
// column frozen; legacy drops the duplicates by id.
const TOP_RESYNC_INTERVAL = 10 * 60 * 1000;
const topFetches = {};

function topFetchDue(feedKey) {
    return Date.now() - (topFetches[feedKey] ?? 0) >= TOP_RESYNC_INTERVAL;
}

function noteTopFetch(feedKey) {
    topFetches[feedKey] = Date.now();
}

const HOME_TIMELINE_FEATURES = {"rweb_video_screen_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":false,"rweb_tipjar_consumption_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_jetfuel_frame":true,"responsive_web_grok_share_attachment_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"responsive_web_grok_show_grok_translated_post":false,"responsive_web_grok_analysis_button_from_backend":true,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":false,"responsive_web_enhance_cards_enabled":false};
function homeTimelineUrl(cursor) {
    const variables = { count: 40, includePromotedContent: true, latestControlAvailable: true };
    if (cursor) variables.cursor = cursor;
    return `${NEW_API}/cWF3cqWadLlIXA6KJWhcew/HomeLatestTimeline?${generateParams(HOME_TIMELINE_FEATURES, variables)}`;
}

const NOTIFICATIONS_ALL_URL = `https://${location.hostname}/i/api/2/notifications/all.json?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1&include_ext_has_nft_avatar=1&include_ext_is_blue_verified=1&include_ext_verified_type=1&include_ext_profile_image_shape=1&skip_status=1&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_ext_limited_action_results=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&include_ext_views=true&include_entities=true&include_user_entities=true&include_ext_media_color=true&include_ext_media_availability=true&include_ext_sensitive_media_warning=true&include_ext_trusted_friends_metadata=true&send_error_codes=true&simple_quoted_tweet=true&count=20&requestContext=launch&ext=mediaStats%2ChighlightedLabel%2ChasNftAvatar%2CvoiceInfo%2CbirdwatchPivot%2CsuperFollowMetadata%2CunmentionInfo%2CeditControl`;
function notificationsAllUrl(cursor) {
    return `${NOTIFICATIONS_ALL_URL}${cursor ? `&cursor=${cursor}` : ""}`;
}

// A since poll re-reads the top of all.json with no cursor. cursor-top is suspected of
// omitting unread notifications (#507, #487), and one page is 20 items. The bottom cursor
// on that top page is not the column's scroll position; storing it would make the next
// max_id request refetch the first page until legacy treats the feed as exhausted.
function storeNotificationCursors(entries, storage, prefix) {
    const top = findCursor(entries, "top");
    if (top) cursors[`${prefix}-${storage.user_id}-top`] = top;
    if (storage.since_id) return;
    const bottom = findCursor(entries, "bottom");
    if (bottom) cursors[`${prefix}-${storage.user_id}-bottom`] = bottom;
}

// The Notifications and Mentions columns both read the top of all.json, each on its own legacy
// timer. The timers neither started together nor shared a period (see POLL_FLOORS), so the same
// mention reached one column well after the other, and both fetched the same page. Now a top-page
// request that goes out also answers every top-page request of that account made while it is in
// flight or shortly after, and when it lands the other column type polls at once.
const SHARED_TOP_PAGE_TTL = 5 * 1000;
const sharedTopPages = {};

function notificationsResponseText(xhr) {
    return xhr.storage.sharedTopPage ?? xhr.responseText;
}

function answerWithTopPage(xhr, text) {
    xhr.storage.sharedTopPage = text;
    emulateResponse(xhr);
}

function sendNotificationsTopPage(xhr, data, otherFeedType) {
    const user_id = xhr.storage.user_id;
    const shared = sharedTopPages[user_id];
    if (shared && shared.waiting) {
        shared.waiting.push({ xhr, data });
        return;
    }
    if (shared && Date.now() - shared.time < SHARED_TOP_PAGE_TTL) {
        answerWithTopPage(xhr, shared.text);
        return;
    }
    const page = { waiting: [] };
    sharedTopPages[user_id] = page;
    xhr.addEventListener("loadend", () => {
        const waiting = page.waiting;
        page.waiting = null;
        // Answering a request runs legacy's handlers, and one that throws must not strand the rest.
        const settle = (answer) => {
            for (const other of waiting) {
                try {
                    answer(other);
                } catch (e) {
                    console.error(e);
                }
            }
        };
        if (xhr.status !== 200) {
            // Nothing to share. The others ask X themselves, as they would have without this.
            if (sharedTopPages[user_id] === page) delete sharedTopPages[user_id];
            settle((other) => other.xhr.send(other.data));
            return;
        }
        page.time = Date.now();
        page.text = xhr.responseText;
        settle((other) => answerWithTopPage(other.xhr, page.text));
        pollNotificationFeedsNow(user_id, otherFeedType);
    });
    xhr.send(data);
}

// Legacy's feed scheduler keeps one periodic task per account and feed type. Running it now hands
// that column the page that just arrived, and restarting its timer keeps it in step with this one
// instead of fetching again on its own a few seconds later.
function pollNotificationFeedsNow(user_id, feedType) {
    try {
        const task = TD.controller.feedScheduler._getTask(`twitter:${user_id}`, feedType);
        if (!task || !task.taskId || !task.doTask) return;
        TD.controller.scheduler.restartPeriodicTask(task.taskId);
        task.doTask({});
    } catch (e) {
        // TD not ready or its internals changed: that column keeps polling on its own timer.
    }
}

// Legacy marks a feed as exhausted below a page when a request returns fewer than ten chirps
// (FeedPoller.EXHAUSTED_API_THRESHOLD in bundle.js) and never asks for older ones again. REST
// pages were a steady 40, but ours are a GraphQL page minus promoted, muted and unparsable
// entries, so a short page is normal: only an empty one should end infinite scroll. And an empty
// first page (X over capacity) used to pin the feed as exhausted for good; lift that on refresh.
let legacyFeedPollerPatched = false;
function relaxLegacyExhaustion() {
    if (legacyFeedPollerPatched) return;
    try {
        const Original = TD.controller.FeedPoller;
        if (typeof Original !== "function") return;
        const Patched = function (feed) {
            Original.call(this, feed);
            this.EXHAUSTED_API_THRESHOLD = 1;
            const refresh = this.refresh;
            this.refresh = function () {
                const possible = this.intervalOfPossibility;
                if (possible && possible.constructor && possible.constructor.whole) {
                    this.intervalOfPossibility = possible.constructor.whole;
                }
                return refresh.apply(this, arguments);
            };
        };
        Patched.prototype = Original.prototype;
        Object.assign(Patched, Original);
        TD.controller.FeedPoller = Patched;
        legacyFeedPollerPatched = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// Legacy's feed scheduler polls each feed type no faster than a floor (in seconds), and stretches
// that to fit the rate limit X reports. Its scheduler ticks once a second, so a column polls every
// floor to floor + 1 seconds. Home and notifications come first and bookmarks last:
// - Home keeps legacy's own 4 s, now that its polls are no longer dropped at random.
// - Notifications polled every 15 s whatever the rate limit: legacy asks for about_me.json without
//   a feed type, so it never reads the headers, and the faster_notifications decider caps its 45 s
//   default at 15 s. Giving it its feed type lets the floor below apply. Mentions reads the same
//   all.json page and gets the same floor, so neither column trails the other.
// - Bookmarks waits at least a minute.
// localStorage can override each floor, in seconds.
const POLL_FLOORS = {
    home: ["OTDhomeRefreshSeconds", 4],
    interactions: ["OTDnotificationsRefreshSeconds", 7],
    mentions: ["OTDnotificationsRefreshSeconds", 7],
    bookmarks: ["OTDbookmarksRefreshSeconds", 60],
};

let legacyPollingTuned = false;
function tuneLegacyPolling() {
    if (legacyPollingTuned) return;
    try {
        const floors = TD.controller.feedScheduler.FEED_TYPE_TO_MINIMUM_REFRESH_PERIOD;
        const client = TD.services.TwitterClient.prototype;
        if (!floors || typeof client.getActivityTimeline !== "function") return;
        for (const [feedType, [key, fallback]] of Object.entries(POLL_FLOORS)) {
            const stored = parseFloat(localStorage[key]);
            floors[feedType] = stored > 0 ? stored : fallback;
        }
        const getActivityTimeline = client.getActivityTimeline;
        client.getActivityTimeline = function (path, since, max, count, success, error, params, feedType) {
            if (path === "activity/about_me.json" && !feedType) feedType = "interactions";
            return getActivityTimeline.call(this, path, since, max, count, success, error, params, feedType);
        };
        legacyPollingTuned = true;
    } catch (e) {
        // TD isn't loaded yet; the next state load tries again.
    }
}

// Legacy closes every desktop notification five seconds after it shows (TD.controller.notifications
// in bundle.js). On Windows that takes it off the screen and out of the Action Center, whatever
// the system's display time is (#381, #338). Its onshow handler does nothing else, so ignore it
// and leave the notification to the OS. bundle.js reads window.Notification when it loads, after
// this file.
if (typeof Notification === "function") {
    const NativeNotification = Notification;
    Notification = class extends NativeNotification {
        static get permission() {
            return NativeNotification.permission;
        }
        static requestPermission(...args) {
            return NativeNotification.requestPermission(...args);
        }
        get onshow() {
            return null;
        }
        set onshow(handler) {}
    };
}

function getCurrentUserId() {
    let accounts = TD.storage.accountController.getAll();
    let screen_name = TD.storage.accountController.getUserIdentifier();
    let account = accounts.find((account) => account.state.username === screen_name);
    return account?.state?.userId ?? verifiedUser?.id_str ?? localStorage.twitterAccountID;
}

function generateParams(features, variables, fieldToggles) {
    let params = new URLSearchParams();
    params.append("variables", JSON.stringify(variables));
    params.append("features", JSON.stringify(features));
    if (fieldToggles) params.append("fieldToggles", JSON.stringify(fieldToggles));

    return params.toString();
}

function extractAssignedJSON(html, varName = "window.__INITIAL_STATE__") {
    const assignPos = html.indexOf(varName);
    if (assignPos === -1) {
        console.error(html);
        throw new Error(`Variable ${varName} not found`);
    }
  
    let i = assignPos + varName.length;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== '=') {
      i = html.indexOf('=', i);
      if (i === -1) throw new Error(`Assignment for ${varName} not found`);
    }
    i++; // skip '='
    while (i < html.length && /\s/.test(html[i])) i++;
  
    const opener = html[i];
    if (opener !== '{' && opener !== '[') {
      throw new Error(`Expected JSON object/array after ${varName} = ...`);
    }
    const closer = opener === '{' ? '}' : ']';
  
    let depth = 0, inStr = false, quote = null, escaped = false;
    const start = i;
    for (; i < html.length; i++) {
      const ch = html[i];
  
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quote) {
          inStr = false;
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        continue;
      }
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`Unterminated JSON for ${varName}`);
  
    let jsonText = html.slice(start, i + 1);
  
    let j = i + 1;
    while (j < html.length && /\s/.test(html[j])) j++;
    if (html[j] === ';') j++;
  
    try {
      return JSON.parse(stripBOM(jsonText));
    } catch (e) {
      const repaired = repairCommonJSONIssues(jsonText);
      try {
        return JSON.parse(repaired);
      } catch (e2) {
        const ctx = repaired.slice(0, 1200);
        throw new Error(
          `Found assignment, but JSON.parse failed twice. First: ${e.message}. Second: ${e2.message}. ` +
          `Sample of repaired text start:\n${ctx}`
        );
      }
    }
  
    function stripBOM(s) {
      return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
    }
  
    function repairCommonJSONIssues(s) {
      s = stripBOM(s);
  
      let out = '';
      let inStr = false;
      let quote = null;
      let escaped = false;
  
      for (let k = 0; k < s.length; k++) {
        let ch = s[k];
  
        if (!inStr) {
          if (ch === '"' || ch === "'") {
            inStr = true;
            quote = ch;
            out += ch;
            continue;
          }
          out += ch;
          continue;
        }
  
        if (escaped) {
          escaped = false;
          out += ch;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          out += ch;
          continue;
        }
        if (ch === quote) {
          inStr = false;
          quote = null;
          out += ch;
          continue;
        }
  
        const code = ch.charCodeAt(0);
  
        if (code === 0x2028) { out += '\\u2028'; continue; }
        if (code === 0x2029) { out += '\\u2029'; continue; }
  
        if (code >= 0x00 && code <= 0x1F) {
          if (ch === '\n') { out += '\\n'; continue; }
          if (ch === '\r') { out += '\\r'; continue; }
          if (ch === '\t') { out += '\\t'; continue; }
          if (ch === '\b') { out += '\\b'; continue; }
          if (ch === '\f') { out += '\\f'; continue; }
          out += '\\u' + code.toString(16).padStart(4, '0');
          continue;
        }
  
        out += ch;
      }
  
      return out;
    }
}
// Legacy TweetDeck derives a chirp id from the REST action object (generateInternalID on
// TwitterActionOnTweet / TwitterActionFollow in bundle.js); mirror it so we can ask its pollers
// whether they already hold a notification. "reply" renders as a mention, "quote" as quoted_tweet.
function legacyNotificationId(action, userId, targetId) {
    const legacyAction = action === "reply" ? "mention" : action === "quote" ? "quoted_tweet" : action;
    return `${legacyAction}_${userId}_${targetId}`;
}

// Legacy's fromRESTData throws when a mention's author is missing, and processActions
// then drops the whole page. Skip that entry. A quote whose tweet or author is missing
// is left off the entry instead of failing it.
function notificationTweet(go, tweetId) {
    const tweet = go?.tweets?.[tweetId];
    const user = tweet && go.users?.[tweet.user_id_str];
    if (!tweet || !user) return null;
    tweet.user = user;
    if (tweet.quoted_status_id_str) {
        const quoted = go.tweets[tweet.quoted_status_id_str];
        const quotedUser = quoted && go.users?.[quoted.user_id_str];
        if (quoted && quotedUser) {
            quoted.user = quotedUser;
            tweet.quoted_status = quoted;
        }
    }
    return tweet;
}

function notificationPollers(user_id) {
    const pollers = [];
    try {
        const accountKey = `twitter:${user_id}`;
        const columns = TD.controller.columnManager.getAll();
        for (const key in columns) {
            for (const feed of columns[key].getFeeds()) {
                if (feed.getType() !== "interactions" || feed.getAccountKey() !== accountKey) continue;
                const poller = TD.controller.feedManager.getPoller(feed.getKey());
                if (poller && !pollers.includes(poller)) pollers.push(poller);
            }
        }
    } catch (e) {
        // TD not ready or its internals changed: notificationDeliveryFilter falls back to the session-wide set.
    }
    return pollers;
}

// Every Notifications column polls through the same route, and one account can have several of
// them (each filter combination gets its own feed and poller). Judging "already delivered" with one
// global set starves whichever poller asks second, so judge it per poller instead: a notification
// is only skipped once every poller for that account already holds it.
function notificationDeliveryFilter(user_id) {
    const pollers = notificationPollers(user_id);
    if (pollers.length === 0) {
        return (id) => {
            if (seenNotifications.has(id)) return false;
            seenNotifications.add(id);
            return true;
        };
    }
    return (id) => !pollers.every((poller) => poller.chirpIndex && poller.chirpIndex[id]);
}

function stableNotificationPosition(id, position) {
    if (!notificationPositions.has(id)) notificationPositions.set(id, position);
    return notificationPositions.get(id);
}

function formatTwitterStyle(date) {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  
    const day = days[date.getUTCDay()];
    const month = months[date.getUTCMonth()];
    const dayNum = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const mins = String(date.getUTCMinutes()).padStart(2, "0");
    const secs = String(date.getUTCSeconds()).padStart(2, "0");
    const year = date.getUTCFullYear();
  
    return `${day} ${month} ${dayNum} ${hours}:${mins}:${secs} +0000 ${year}`;
}

function emulateResponse(xhr) {
    xhr._status = xhr._status ?? 200;
    xhr._readyState = 4;
    xhr.responseHeaderOverride = {
        "content-type": () => "application/json"
    }
    const loadEvent = new ProgressEvent('load');
    loadEvent.lengthComputable = true;
    loadEvent.loaded = 1;
    loadEvent.total = 1;

    if(xhr.onload) xhr.onload(loadEvent);
    if(xhr.onloadend) xhr.onloadend(loadEvent);

    const readyStateEvent = new Event('readystatechange');
    if(xhr.onreadystatechange) xhr.onreadystatechange(readyStateEvent);
}

let counter = 0;
let bookmarkTimes = {};

// screen_name -> id, filled as GraphQL users are parsed, so adding a list member
// can use the id TweetDeck's form does not send.
const screenNameIds = {};
const USER_BY_SCREEN_NAME_FEATURES = {"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true};
const USER_BY_REST_ID_FEATURES = {"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true};
const LIST_MEMBER_MUTATION_FEATURES = {"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true};
const LIST_MEMBERS_FEATURES = {"rweb_video_screen_enabled":false,"rweb_cashtags_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"responsive_web_profile_redirect_enabled":true,"rweb_tipjar_consumption_enabled":false,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"rweb_cashtags_composer_attachment_enabled":true,"responsive_web_jetfuel_frame":true,"rweb_sports_post_context_enabled":true,"responsive_web_grok_share_attachment_enabled":true,"responsive_web_grok_annotations_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"rweb_conversational_replies_downvote_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"content_disclosure_indicator_enabled":true,"content_disclosure_ai_generated_indicator_enabled":true,"responsive_web_grok_show_grok_translated_post":true,"responsive_web_grok_analysis_button_from_backend":true,"post_ctas_fetch_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":false,"responsive_web_nested_quote_preview_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_imagine_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":true,"responsive_web_enhance_cards_enabled":false};

function rememberUser(user) {
    if (user && user.screen_name && user.id_str) {
        screenNameIds[String(user.screen_name).toLowerCase()] = String(user.id_str);
    }
}

function legacyUserFromGraph(result) {
    if (!result || result.__typename === "UserUnavailable") return null;
    const legacy = result.legacy || {};
    const id = result.rest_id || legacy.id_str;
    const screen = legacy.screen_name || result.core?.screen_name;
    if (!id || !screen) return null;
    const image = String(legacy.profile_image_url_https || result.avatar?.image_url || "").replace("http://", "https://");
    const user = Object.assign({}, legacy, {
        id_str: String(id),
        id: +id,
        screen_name: screen,
        name: legacy.name || result.core?.name || screen,
        profile_image_url_https: image,
        created_at: legacy.created_at || result.core?.created_at || "",
    });
    if (!user.profile_image_url) user.profile_image_url = image.replace("https://", "http://");
    if (result.is_blue_verified || result.verification?.verified) user.verified = true;
    if (result.privacy?.protected) user.protected = true;
    if (result.relationship_perspectives?.muting) user.muting = true;
    if (result.relationship_perspectives?.blocking) user.blocking = true;
    if (result.location?.location && !user.location) user.location = result.location.location;
    rememberUser(user);
    return user;
}

function listMemberTimeline(data) {
    return data?.data?.list?.members_timeline?.timeline
        || data?.data?.list?.membersTimeline?.timeline
        || null;
}

function listMemberEntries(data) {
    const instructions = listMemberTimeline(data)?.instructions || [];
    const add = instructions.find((i) => i.type === "TimelineAddEntries");
    return add?.entries || [];
}

function listMemberMutationHeaders(xhr) {
    xhr.modReqHeaders["Content-Type"] = "application/json";
    xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
    xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
    xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
    delete xhr.modReqHeaders["X-Twitter-Client-Version"];
}

function lookupUserId(screenName) {
    const known = screenNameIds[String(screenName || "").toLowerCase()];
    if (known) return Promise.resolve(known);
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = new XMLHttpRequest();
        } catch (e) {
            reject(e);
            return;
        }
        if (!req || typeof req.open !== "function") {
            reject(new Error("user lookup unavailable"));
            return;
        }
        const url = `${NEW_API}/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName?${generateParams(
            USER_BY_SCREEN_NAME_FEATURES,
            { screen_name: screenName, withGrokTranslatedBio: true },
            { withPayments: false, withAuxiliaryUserLabels: true }
        )}`;
        req.open("GET", url, true);
        req.onload = () => {
            try {
                const data = JSON.parse(req.responseText);
                const user = legacyUserFromGraph(data?.data?.user?.result);
                if (!user) reject(new Error("missing user"));
                else resolve(user.id_str);
            } catch (e) {
                reject(e);
            }
        };
        req.onerror = () => reject(new Error("user lookup failed"));
        req.send();
    });
}

function legacyListFromGraph(data, fallback) {
    const raw = data?.data?.list
        || data?.data?.list_add_member
        || data?.data?.listAddMember
        || data?.data?.list_remove_member
        || data?.data?.listRemoveMember;
    const node = raw && typeof raw === "object" ? raw : {};
    const id = node.id_str || node.rest_id || fallback.listId || "";
    const owner = legacyUserFromGraph(node.user_results?.result || node.user_result?.result) || {
        id_str: "0",
        id: 0,
        screen_name: "",
        name: "",
        profile_image_url_https: "",
    };
    const mode = String(node.mode || "public").toLowerCase();
    return {
        id_str: String(id),
        id: +id || 0,
        name: node.name || "",
        description: node.description || "",
        slug: node.slug || "",
        full_name: node.full_name || node.name || "",
        member_count: node.member_count ?? 0,
        mode: mode === "private" ? "private" : "public",
        user: owner,
    };
}

function listMutationResult(xhr) {
    if (xhr.storage.listResult) return xhr.storage.listResult;
    let data;
    try {
        data = JSON.parse(xhr.responseText);
    } catch (e) {
        xhr._status = 503;
        return { errors: [{ message: "Could not update list members" }] };
    }
    if (data?.errors && !data?.data) {
        xhr._status = 503;
        return { errors: [{ message: data.errors[0]?.message || "Could not update list members" }] };
    }
    return legacyListFromGraph(data, { listId: xhr.storage.listId });
}

function postListMember(listId, userId, queryId, operation) {
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = new XMLHttpRequest();
        } catch (e) {
            reject(e);
            return;
        }
        if (!req || typeof req.open !== "function") {
            reject(new Error("list mutation unavailable"));
            return;
        }
        req.open("POST", `${NEW_API}/${queryId}/${operation}`, true);
        req.onload = () => {
            try {
                resolve(JSON.parse(req.responseText));
            } catch (e) {
                reject(e);
            }
        };
        req.onerror = () => reject(new Error("list mutation failed"));
        req.send(JSON.stringify({
            variables: { listId, userId },
            features: LIST_MEMBER_MUTATION_FEATURES,
            queryId,
        }));
    });
}

function sendListMemberMutation(xhr, body) {
    const params = new URLSearchParams(body || "");
    const listId = params.get("list_id") || "";
    const names = (params.get("screen_name") || "").split(",").map((name) => name.trim()).filter(Boolean);
    xhr.storage.listId = listId;
    Promise.all(names.map((name) => lookupUserId(name))).then(async (ids) => {
        if (!listId || !ids.length || ids.some((id) => !id)) {
            failWithoutRequest(xhr, "could not resolve a list member");
            emulateResponse(xhr);
            return;
        }
        if (!xhr.storage.many) {
            xhr.send(JSON.stringify({
                variables: { listId, userId: ids[0] },
                features: LIST_MEMBER_MUTATION_FEATURES,
                queryId: xhr.storage.queryId,
            }));
            return;
        }
        try {
            let last;
            for (const userId of ids) {
                last = await postListMember(listId, userId, xhr.storage.queryId, xhr.storage.operation);
            }
            xhr.storage.listResult = legacyListFromGraph(last, { listId });
            emulateResponse(xhr);
        } catch (e) {
            console.error(e);
            failWithoutRequest(xhr, "could not add list members");
            emulateResponse(xhr);
        }
    }).catch((e) => {
        console.error(e);
        failWithoutRequest(xhr, "could not resolve a list member");
        emulateResponse(xhr);
    });
}

const OriginalXHR = XMLHttpRequest;
const proxyRoutes = [
    // Home timeline
    {
        path: "/1.1/statuses/home_timeline.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.home?.home_timeline_urt),
        beforeRequest: (xhr) => {
            try {
                let params = new URL(xhr.modUrl).searchParams;
                xhr.storage.max_id = params.get("max_id");
                xhr.storage.since_id = params.get("since_id");
                if (params.get("user_id")) {
                    xhr.storage.user_id = params.get("user_id");
                }
                // Legacy adds x-act-as-user-id after open(), so which account's cursor to use is
                // only known in beforeSend; until then this is the cursor-less URL.
                xhr.modUrl = homeTimelineUrl();
            } catch (e) {
                console.error(e);
            }
        },
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            const feedKey = `home-${user_id}`;
            const { max_id, since_id } = xhr.storage;
            let cursor;
            if (max_id) {
                const requested = String(BigInt(max_id) + 1n);
                cursor = timelineCursor(feedKey, requested, "bottom");
                if (!cursor) {
                    // Legacy wants tweets below a chirp we never handed it. The only thing we could
                    // fetch is the top of the timeline, which it would discard and retry five times.
                    failWithoutRequest(xhr, `no bottom cursor for home max_id=${max_id}`);
                    return;
                }
                xhr.storage.requested_id = requested;
            } else if (since_id && !topFetchDue(feedKey)) {
                cursor = timelineCursor(feedKey, since_id, "top");
                if (!cursor) noteTopFetch(feedKey);
            } else {
                noteTopFetch(feedKey);
            }
            // Pacing is left to legacy's scheduler (see POLL_FLOORS).
            xhr.modUrl = homeTimelineUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if (xhr.storage.cancelled || xhr._status) {
                return [];
            }
            if (xhr.storage.data) {
                return xhr.storage.data;
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            const timeline = data?.data?.home?.home_timeline_urt;
            if (!timeline) {
                if (data?.errors) console.warn("OldTweetDeck: home timeline errors", data.errors);
                return [];
            }
            let entries = timeline.instructions?.find((i) => i.type === "TimelineAddEntries")?.entries;
            if (!entries) {
                return [];
            }
            const user_id = xhr.storage.user_id;
            const feedKey = `home-${user_id}`;
            let tweets = [];
            let threads = [];
            for (let e of entries) {
                // thats a lot of trash https://lune.dimden.dev/0bf524e52eb.png
                if (e.entryId.startsWith("tweet-")) {
                    if (isPromoted(e)) continue;
                    let res = e.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(res);
                    if (!tweet || tweetHidden(tweet)) continue;

                    tweets.push(tweet);
                } else if (e.entryId.startsWith("home-conversation-")) {
                    let items = e.content.items;

                    let thread = [];
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        if (
                            (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) &&
                            !isPromoted(item)
                        ) {
                            let res = item.item.itemContent.tweet_results.result;
                            let tweet = safeParseTweet(res);
                            if (!tweet || tweetHidden(tweet)) continue;
                            if (item.item.feedbackInfo) {
                                tweet.feedback = item.item.feedbackInfo.feedbackKeys
                                    .map(
                                        (f) =>
                                            timeline.responseObjects?.feedbackActions?.find(
                                                (a) => a.key === f
                                            )?.value
                                    )
                                    .filter((f) => f);
                                if (tweet.feedback) {
                                    tweet.feedbackMetadata =
                                        item.item.feedbackInfo.feedbackMetadata;
                                }
                            }
                            thread.push(tweet);
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }
            for (let tweet of threadTweetsInRange(tweets, threads, xhr.storage.since_id)) {
                // a poll can re-send a thread the column already shows
                if (xhr.storage.since_id && !rememberHomeTweet(user_id, tweet.id_str)) continue;
                tweets.push(tweet);
            }

            const bottomCursor = findCursor(entries, "bottom");
            if (tweets.length === 0) {
                // Nothing survived the filters but there may be more below: let the next request
                // for the same bound go one page deeper instead of fetching this one again.
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }

            sortNewestFirst(tweets);
            for (let tweet of tweets) {
                rememberHomeTweet(user_id, tweet.id_str);
            }
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(entries, "top"));

            xhr.storage.data = tweets;

            return tweets;
        },
    },
    // List timeline
    {
        path: "/1.1/lists/statuses.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.list?.tweets_timeline?.timeline),
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = { count: 40, includePromotedContent: false };
                let features = {"rweb_video_screen_enabled":false,"payments_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"premium_content_api_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":true,"responsive_web_jetfuel_frame":true,"responsive_web_grok_share_attachment_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"responsive_web_grok_show_grok_translated_post":false,"responsive_web_grok_analysis_button_from_backend":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_grok_image_annotation_enabled":true,"responsive_web_grok_community_note_auto_translation_is_enabled":false,"responsive_web_enhance_cards_enabled":false};

                let list_id = params.get("list_id");
                let max_id = params.get("max_id");
                let since_id = params.get("since_id");
                const feedKey = `list-${list_id}`;
                xhr.storage.max_id = max_id;
                xhr.storage.since_id = since_id;
                if (max_id) {
                    const requested = String(BigInt(max_id) + 1n);
                    const cursor = timelineCursor(feedKey, requested, "bottom");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.requested_id = requested;
                    } else {
                        xhr.storage.missingCursor = true;
                    }
                } else if (since_id && !topFetchDue(feedKey)) {
                    const cursor = timelineCursor(feedKey, since_id, "top");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.cursor = true;
                    } else {
                        noteTopFetch(feedKey);
                    }
                } else {
                    noteTopFetch(feedKey);
                }
                variables.listId = list_id;
                xhr.storage.list_id = list_id;
                xhr.modUrl = `${NEW_API}/l411pL-GRg-AKo_a2rmYjg/ListLatestTweetsTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        openHandler: (xhr, method, url, async, username, password) => {
            const list_id = xhr.storage.list_id;
            if(!timings.list[list_id]) {
                timings.list[list_id] = 0;
            }
            if (xhr.storage.missingCursor) {
                failWithoutRequest(xhr, `no bottom cursor for list ${list_id} max_id=${xhr.storage.max_id}`);
            } else if(Date.now() - timings.list[list_id] < refreshInterval && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async ?? true, username, password);
                timings.list[list_id] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled || xhr._status) {
                return [];
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            let list = data?.data?.list?.tweets_timeline?.timeline?.instructions?.find(
                (i) => i.type === "TimelineAddEntries"
            );
            if (!list) return [];
            list = list.entries;
            let tweets = [];
            let threads = [];
            for (let e of list) {
                if (e.entryId.startsWith("tweet-")) {
                    if (isPromoted(e)) continue;
                    let res = e.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(res);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (e.entryId.startsWith("list-conversation-")) {
                    let lt = e.content.items;
                    let thread = [];
                    for (let i = 0; i < lt.length; i++) {
                        let t = lt[i];
                        if ((t.entryId.startsWith("tweet-") || t.entryId.includes("-tweet-")) && !isPromoted(t)) {
                            let res = t.item.itemContent.tweet_results.result;
                            let tweet = safeParseTweet(res);
                            if (!tweet) continue;
                            thread.push(tweet);
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }

            const visible = (t) => !tweetHidden(t);
            tweets = tweets.filter(visible);
            threads = threads.map((thread) => thread.filter(visible)).filter((thread) => thread.length);
            tweets.push(...threadTweetsInRange(tweets, threads, xhr.storage.since_id));

            const feedKey = `list-${xhr.storage.list_id}`;
            const bottomCursor = findCursor(list, "bottom");
            if (tweets.length === 0) {
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }
            sortNewestFirst(tweets);
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(list, "top"));

            return tweets;
        },
    },
    // User timeline
    {
        path: "/1.1/statuses/user_timeline.json",
        method: "GET",
        inspectResponse: graphqlPageInspector((data) => data?.data?.user?.result?.timeline_v2?.timeline),
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let user_id = params.get("user_id");
                let variables = {
                    count: 20,
                    includePromotedContent: false,
                    withQuickPromoteEligibilityTweetFields: false,
                    withVoice: true,
                    withV2Timeline: true,
                };
                let features = {
                    rweb_lists_timeline_redesign_enabled: false,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: true,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    responsive_web_twitter_article_tweet_consumption_enabled: false,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: true,
                    responsive_web_media_download_video_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                };

                if (!user_id) {
                    variables.userId = getCurrentUserId();
                } else {
                    variables.userId = user_id;
                }
                let since_id = params.get("since_id");
                let max_id = params.get("max_id");
                const feedKey = `user-${variables.userId}`;
                xhr.storage.max_id = max_id;
                xhr.storage.since_id = since_id;
                if (max_id) {
                    const requested = String(BigInt(max_id) + 1n);
                    const cursor = timelineCursor(feedKey, requested, "bottom");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.requested_id = requested;
                    } else {
                        xhr.storage.missingCursor = true;
                    }
                } else if (since_id && !topFetchDue(feedKey)) {
                    const cursor = timelineCursor(feedKey, since_id, "top");
                    if (cursor) {
                        variables.cursor = cursor;
                        xhr.storage.cursor = true;
                    } else {
                        noteTopFetch(feedKey);
                    }
                } else {
                    noteTopFetch(feedKey);
                }
                xhr.storage.user_id = variables.userId;

                xhr.modUrl = `${NEW_API}/wxoVeDnl0mP7VLhe6mTOdg/UserTweetsAndReplies?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        openHandler: (xhr, method, url, async, username, password) => {
            const user_id = xhr.storage.user_id;
            if(!timings.user[user_id]) {
                timings.user[user_id] = 0;
            }
            if (xhr.storage.missingCursor) {
                failWithoutRequest(xhr, `no bottom cursor for user ${user_id} max_id=${xhr.storage.max_id}`);
            } else if(Date.now() - timings.user[user_id] < refreshInterval && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async ?? true, username, password);
                timings.user[user_id] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled || xhr._status) {
                return [];
            }
            let data = xhr.storage.parsed;
            if (!data) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    console.error(e);
                    return [];
                }
            }
            let instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let tweets = [];
            let threads = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(result);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (entry.entryId.startsWith("profile-conversation-")) {
                    let items = entry.content.items;
                    let thread = [];
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        let result = item.item.itemContent.tweet_results.result;
                        if (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) {
                            let tweet = safeParseTweet(result);
                            if (tweet && tweet.user.id_str === xhr.storage.user_id) {
                                thread.push(tweet);
                            }
                        }
                    }
                    if (thread.length) threads.push(thread);
                }
            }
            tweets.push(...threadTweetsInRange(tweets, threads, xhr.storage.since_id));

            const feedKey = `user-${xhr.storage.user_id}`;
            const bottomCursor = findCursor(entries, "bottom");
            if (tweets.length === 0) {
                if (xhr.storage.requested_id && bottomCursor) {
                    advanceTimelineCursor(feedKey, xhr.storage.requested_id, bottomCursor);
                }
                return tweets;
            }
            sortNewestFirst(tweets);
            rememberTimelinePage(feedKey, tweets, bottomCursor, findCursor(entries, "top"));

            let pinEntry = instructions.find((e) => e.type === "TimelinePinEntry");
            if (
                pinEntry &&
                pinEntry.entry &&
                pinEntry.entry.content &&
                pinEntry.entry.content.itemContent
            ) {
                let result = pinEntry.entry.content.itemContent.tweet_results.result;
                let pinnedTweet = safeParseTweet(result);
                if (pinnedTweet) {
                    let tweetTimes = tweets.map((t) => [
                        t.id_str,
                        new Date(t.created_at).getTime(),
                    ]);
                    tweetTimes.push([
                        pinnedTweet.id_str,
                        new Date(pinnedTweet.created_at).getTime(),
                    ]);
                    tweetTimes.sort((a, b) => b[1] - a[1]);
                    let index = tweetTimes.findIndex((t) => t[0] === pinnedTweet.id_str);
                    if (index !== tweets.length) {
                        tweets.splice(index, 0, pinnedTweet);
                    }
                }
            }

            return tweets;
        },
    },
    // Bookmarks timeline
    {
        path: "/1.1/statuses/bookmarks.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                xhr.storage.variables = {
                    "count": 40,
                    "includePromotedContent":false
                };
                xhr.storage.features = {"graphql_timeline_v2_bookmark_timeline":true,"blue_business_profile_image_shape_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"tweetypie_unmention_optimization_enabled":true,"vibe_api_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"interactive_text_enabled":true,"responsive_web_text_conversations_enabled":false,"longform_notetweets_rich_text_read_enabled":true,"responsive_web_enhance_cards_enabled":false};

                let max_id = params.get("max_id");
                if (max_id) {
                    xhr.storage.bn = String(BigInt(max_id) + 1n);
                }
                if (params.get("user_id")) xhr.storage.user_id = params.get("user_id");
            } catch (e) {
                console.error(e);
            }
        },
        // The acting account is only known once legacy has set x-act-as-user-id.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            if (!xhr.storage.variables || !xhr.storage.features) {
                openDeferred(xhr);
                return;
            }
            const bn = xhr.storage.bn;
            if (bn && cursors[`bookmarks-${user_id}-${bn}`]) {
                xhr.storage.variables.cursor = cursors[`bookmarks-${user_id}-${bn}`];
            }
            if (bn && bookmarkTimes[`${user_id}:${bn}`] !== undefined) {
                xhr.storage.time = bookmarkTimes[`${user_id}:${bn}`];
            }
            xhr.modUrl = `${NEW_API}/3OjEFzT2VjX-X7w4KYBJRg/Bookmarks?${generateParams(
                xhr.storage.features,
                xhr.storage.variables
            )}`;
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        // artificially slow down, because theres an invisible rate limit that gets hit after a few hours
        responseHeaderOverride: {
            "x-rate-limit-limit": (value) => {
                return Math.floor(+value/5);
            },
            "x-rate-limit-remaining": (value) => {
                return Math.floor(+value/5);
            },
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.bookmark_timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let tweets = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;
                    let tweet = safeParseTweet(result);
                    if (tweet) {
                        tweets.push(tweet);
                    }
                } else if (entry.entryId.startsWith("profile-conversation-")) {
                    let items = entry.content.items;
                    for (let i = 0; i < items.length; i++) {
                        let item = items[i];
                        let result = item.item.itemContent.tweet_results.result;
                        if (item.entryId.startsWith("tweet-") || item.entryId.includes("-tweet-")) {
                            let tweet = safeParseTweet(result);
                            if (tweet && tweet.user.id_str === xhr.storage.user_id) {
                                tweets.push(tweet);
                            }
                        }
                    }
                }
            }

            if (tweets.length === 0) return tweets;

            const user_id = xhr.storage.user_id || "0";
            for(let i = 0; i < tweets.length; i++) {
                const tweet = tweets[i];
                const timeKey = `${user_id}:${tweet.id_str}`;
                tweet.receiveTime = bookmarkTimes[timeKey] ?? ((xhr.storage.time ?? Date.now()) - i);
                bookmarkTimes[timeKey] = tweet.receiveTime;
            }

            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            )?.content?.value;
            if (cursor) {
                cursors[`bookmarks-${user_id}-${tweets[tweets.length - 1].id_str}`] = cursor;
            }

            return tweets;
        },
    },
    // Notifications column
    {
        path: "/1.1/activity/about_me.json",
        method: "GET",
        beforeRequest: (xhr) => {
            const params = new URL(xhr.modUrl).searchParams;
            xhr.storage.since_id = params.get("since_id");
            xhr.storage.max_id = params.get("max_id");
            if (params.get("user_id")) {
                xhr.storage.user_id = params.get("user_id");
            }
            xhr.modUrl = notificationsAllUrl();
        },
        // Which account's cursor applies is only known once legacy has set its headers.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            let cursor;
            if (!xhr.storage.since_id && xhr.storage.max_id && cursors[`notifications-${user_id}-bottom`]) {
                cursor = cursors[`notifications-${user_id}-bottom`];
            }
            xhr.storage.topPage = !cursor;
            xhr.modUrl = notificationsAllUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else if (xhr.storage.topPage) {
                sendNotificationsTopPage(xhr, data, "mentions");
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = navigator.language.split("-")[0];
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if(xhr.storage.notifications) {
                return xhr.storage.notifications;
            }
            try {
                const response = JSON.parse(notificationsResponseText(xhr));
                const entries = response.timeline.instructions.find((i) => i.addEntries).addEntries.entries;
                const go = response.globalObjects;
                const notifications = [];
                const shouldDeliver = notificationDeliveryFilter(xhr.storage.user_id);
                for(let entry of entries) {
                    try {
                        if(entry.entryId.startsWith("notification-")) {
                            const sortIndex = entry.sortIndex;
                            const item = entry.content.item;
                            const type = item.clientEventInfo.element;
                            const notif = item.content.notification;
    
                            switch(type) {
                                case "users_retweeted_your_retweet":
                                case "users_retweeted_your_tweet":
                                case "user_liked_multiple_tweets": 
                                case "users_liked_your_retweet":
                                case "users_liked_your_tweet": {
                                    const nf = go.notifications[notif.id];
                                    const actions = nf.template.aggregateUserActionsV1;
                                    const users = actions.fromUsers.map(u => u.user.id);
                                    const tweets = actions.targetObjects.map(t => t.tweet.id);
                                    let i = 0;
                                    for(const userId of users) {
                                        for(const tweetId of tweets) {
                                            const user = go.users[userId];
                                            const tweet = notificationTweet(go, tweetId);
                                            const action = type === "users_retweeted_your_tweet" || type === "users_retweeted_your_retweet" ? "retweet" : "favorite";
                                            if(!tweet || !user || userHidden(user)) continue;
                                            const id = legacyNotificationId(action, userId, tweetId);
                                            if(!shouldDeliver(id)) continue;
                                            const notifSortIndex = stableNotificationPosition(id, +sortIndex - (i++));
    
                                            const sources = [user];
                                            const targets = [tweet];
                                            const target_objects = [tweet];
                                            notifications.push({
                                                action,
                                                created_at: formatTwitterStyle(new Date(notifSortIndex)),
                                                max_position: notifSortIndex+"",
                                                min_position: notifSortIndex+"",
                                                sources,
                                                sources_size: sources.length,
                                                target_objects,
                                                target_objects_size: target_objects.length,
                                                targets,
                                                targets_size: targets.length,
                                            })
                                        }
                                    }
                                    break;
                                }
                                case "user_mentioned_you":
                                case "user_replied_to_your_tweet": 
                                case "user_quoted_your_tweet":{
                                    const tweetId = item.content.tweet.id;
                                    const tweet = notificationTweet(go, tweetId);
                                    if(!tweet || tweetHidden(tweet)) continue;
                                    const type = item.clientEventInfo.element === "user_mentioned_you" ? "mention" : item.clientEventInfo.element === "user_replied_to_your_tweet" ? "reply" : "quote";
                                    
                                    const id = legacyNotificationId(type, tweet.user_id_str, tweetId);
                                    if(!shouldDeliver(id)) continue;
                                    const position = stableNotificationPosition(id, +sortIndex);
    
                                    notifications.push({
                                        action: type,
                                        created_at: formatTwitterStyle(new Date(position)),
                                        max_position: position+"",
                                        min_position: position+"",
                                        sources: [tweet.user],
                                        sources_size: 1,
                                        target_objects: [tweet],
                                        target_objects_size: 1,
                                        targets: [tweet],
                                        targets_size: 1,
                                    });
                                    break;
                                }
                                case "follow_from_recommended_user":
                                case "users_followed_you": {
                                    const nf = go.notifications[notif.id];
                                    const users = nf.template.aggregateUserActionsV1.fromUsers.map(u => u.user.id);
                                    for(const userId of users) {
                                        const user = go.users[userId];
                                        if(!user || userHidden(user)) continue;
                                        // legacy builds this id from (source user, target user) and OTD hands it the same user for both
                                        const id = legacyNotificationId("follow", userId, userId);
                                        if(!shouldDeliver(id)) continue;
                                        const position = stableNotificationPosition(id, +sortIndex);
                                        notifications.push({
                                            action: "follow",
                                            created_at: formatTwitterStyle(new Date(position)),
                                            max_position: position+"",
                                            min_position: position+"",
                                            sources: [user],
                                            sources_size: 1,
                                            target_objects: [user],
                                            target_objects_size: 1,
                                            targets: [user],
                                            targets_size: 1
                                        });
                                    }
                                    break;
                                }
                                case "generic_login_notification":
                                case "generic_acid_notification":
                                case "generic_safety_label_added":
                                    break;
                                default:
                                    console.warn(`Unknown notification type: ${type}`);
                            }
                        }
                    } catch (e) {
                        console.error(`Error parsing notification`, JSON.stringify(entry));
                    }
                }
                xhr.storage.notifications = notifications;
                storeNotificationCursors(entries, xhr.storage, "notifications");
                return notifications;
            } catch (e) {
                console.error(`Error parsing notifications`, e);
                return [];
            }
        },
    },
    // Mentions timeline
    {
        path: "/1.1/statuses/mentions_timeline.json",
        method: "GET",
        beforeRequest: (xhr) => {
            const params = new URL(xhr.modUrl).searchParams;
            xhr.storage.since_id = params.get("since_id");
            xhr.storage.max_id = params.get("max_id");
            if (params.get("user_id")) {
                xhr.storage.user_id = params.get("user_id");
            }
            // X's mentions.json lags the "all" notifications timeline by half an hour or more and does
            // not catch up while being polled, so fetch the all.json page instead and keep only the
            // mention / reply / quote entries below (the cursors stay under their own `mentions-` keys).
            xhr.modUrl = notificationsAllUrl();
        },
        // Which account's cursor applies is only known once legacy has set its headers.
        openHandler: deferOpen,
        beforeSend: (xhr) => {
            const user_id = requestUserId(xhr);
            xhr.storage.user_id = user_id;
            let cursor;
            if (!xhr.storage.since_id && xhr.storage.max_id && cursors[`mentions-${user_id}-bottom`]) {
                cursor = cursors[`mentions-${user_id}-bottom`];
            }
            xhr.storage.topPage = !cursor;
            xhr.modUrl = notificationsAllUrl(cursor);
            openDeferred(xhr);
        },
        sendHandler: (xhr, data) => {
            if (xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else if (xhr.storage.topPage) {
                sendNotificationsTopPage(xhr, data, "interactions");
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            try {
                const response = JSON.parse(notificationsResponseText(xhr));
                const entries = response.timeline.instructions.find((i) => i.addEntries).addEntries.entries;
                const go = response.globalObjects;
                const tweets = [];
                for(let entry of entries) {
                    if(entry.entryId.startsWith("notification-")) {
                        const sortIndex = entry.sortIndex;
                        const item = entry.content.item;
                        const type = item.clientEventInfo.element;

                        switch(type) {
                            case "user_mentioned_you":
                            case "user_replied_to_your_tweet": 
                            case "user_quoted_your_tweet":{
                                const tweet = notificationTweet(go, item.content.tweet.id);
                                if(!tweet || tweetHidden(tweet)) continue;
                                tweets.push(tweet);
                                break;
                            }
                        }
                    }
                }
                storeNotificationCursors(entries, xhr.storage, "mentions");
                return tweets;
            } catch (e) {
                console.error(`Error parsing mentions`, e);
                return [];
            }
        }
    },
    // User likes timeline
    {
        path: "/1.1/favorites/list.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let user_id = params.get("user_id") ?? getCurrentUserId();
                let variables = {
                    "userId": user_id,
                    "count": 50,
                    "includePromotedContent": false,
                    "withSuperFollowsUserFields": true,
                    "withDownvotePerspective": false,
                    "withReactionsMetadata": false,
                    "withReactionsPerspective": false,
                    "withSuperFollowsTweetFields": true,
                    "withClientEventToken": false,
                    "withBirdwatchNotes": false,
                    "withVoice": true,
                    "withV2Timeline": true
                };
                let features = {
                    "dont_mention_me_view_api_enabled": true,
                    "interactive_text_enabled": true,
                    "responsive_web_uc_gql_enabled": false,
                    "vibe_tweet_context_enabled": false,
                    "responsive_web_edit_tweet_api_enabled": false,
                    "standardized_nudges_misinfo": false,
                    "responsive_web_enhance_cards_enabled": false
                };

                let max_id = params.get("max_id");
                if (max_id) {
                    let bn = BigInt(params.get("max_id"));
                    bn += BigInt(1);
                    if (cursors[`${variables.userId}-${bn}-likes`]) {
                        variables.cursor = cursors[`${variables.userId}-${bn}-likes`];
                    }
                }
                xhr.storage.user_id = variables.userId;

                xhr.modUrl = `${NEW_API}/vni8vUvtZvJoIsl49VPudg/Likes?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            // delete xhr.modReqHeaders["x-act-as-user-id"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions;
            let entries = instructions?.find((e) => e.type === "TimelineAddEntries");
            if (!entries) {
                return [];
            }
            entries = entries.entries;

            let tweets = entries
                .filter(e => e.entryId.startsWith('tweet-') && e.content.itemContent.tweet_results.result)
                .map(e => safeParseTweet(e.content.itemContent.tweet_results.result))
                .filter(e => e);

            if (tweets.length === 0) return tweets;

            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            )?.content?.value;
            if (cursor) {
                cursors[`${xhr.storage.user_id}-${tweets[tweets.length - 1].id_str}-likes`] = cursor;
            }

            // i didn't know they return tweets unsorted???
            tweets.sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            return tweets;
        },
    },
    // Liking / unliking
    {
        path: /\/1\.1\/favorites\/.*\.json/,
        method: "POST",
        beforeRequest: (xhr) => {
            const isFavorite = xhr.modUrl.includes("create.json");
            xhr.storage.isFavorite = isFavorite;

            xhr.modUrl = isFavorite ? 
                `https://${location.hostname}/i/api/graphql/lI07N6Otwv1PhnEgXILM7A/FavoriteTweet` : 
                `https://${location.hostname}/i/api/graphql/ZYKSe-w7KEslx3JhSIk5LA/UnfavoriteTweet`;
        },
        sendHandler: (xhr, data) => {
            const tweet_id = new URLSearchParams(data).get("id");
            xhr.send(JSON.stringify({"variables":{"tweet_id":tweet_id},"queryId":xhr.storage.isFavorite ? "lI07N6Otwv1PhnEgXILM7A" : "ZYKSe-w7KEslx3JhSIk5LA"}));
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            return {};
        },
    },
    // Collections
    {
        path: /\/1\.1\/collections\/.*\.json/,
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            xhr._status = 404;
            return "";
        },
    },
    {
        path: /\/1\.1\/collections\/.*\.json/,
        method: "POST",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            xhr._status = 404;
            return "";
        },
    },
    // User profile. REST users/show is gone; GraphQL ids are the ones current x.com publishes
    // (twitter-openapi placeholder, 2026-10). A missing user stays an error: code 34 on
    // users/show is what TweetDeck turns into "That user does not exist".
    {
        path: "/1.1/users/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                const params = new URL(xhr.modUrl).searchParams;
                const screenName = params.get("screen_name");
                const userId = params.get("user_id");
                xhr.storage.screen_name = screenName;
                xhr.storage.user_id = userId;
                if (userId) {
                    xhr.modUrl = `${NEW_API}/mxaYWwt52eAb6OAzYHMVzg/UserByRestId?${generateParams(
                        USER_BY_REST_ID_FEATURES,
                        { userId, withSafetyModeUserFields: true }
                    )}`;
                } else {
                    xhr.modUrl = `${NEW_API}/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName?${generateParams(
                        USER_BY_SCREEN_NAME_FEATURES,
                        { screen_name: screenName || "", withGrokTranslatedBio: true },
                        { withPayments: false, withAuxiliaryUserLabels: true }
                    )}`;
                }
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                xhr._status = 404;
                return { errors: [{ code: 34, message: "That user does not exist" }] };
            }
            const result = data?.data?.user?.result;
            const user = legacyUserFromGraph(result);
            if (!user) {
                xhr._status = 404;
                return { errors: [{ code: 34, message: "That user does not exist" }] };
            }
            return user;
        },
    },
    // List members. The edit-members modal reads one page (it asks for 5000 and does not follow
    // next_cursor), so this returns the first GraphQL page, capped at 100.
    {
        path: "/1.1/lists/members.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                const params = new URL(xhr.modUrl).searchParams;
                let count = parseInt(params.get("count") || "20", 10);
                if (!count || count < 1) count = 20;
                if (count > 100) count = 100;
                const variables = { listId: params.get("list_id"), count };
                const cursor = params.get("cursor");
                if (cursor && cursor !== "-1" && cursor !== "0") variables.cursor = cursor;
                xhr.modUrl = `${NEW_API}/yQ_0-CTekcCY2oFRTskpSw/ListMembers?${generateParams(
                    LIST_MEMBERS_FEATURES,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                xhr._status = 503;
                return { errors: [{ message: "Could not read list members" }] };
            }
            if (data?.errors && !listMemberTimeline(data)) {
                xhr._status = 503;
                return { errors: [{ message: data.errors[0]?.message || "Could not read list members" }] };
            }
            const entries = listMemberEntries(data);
            const users = [];
            for (const entry of entries) {
                const result = entry?.content?.itemContent?.user_results?.result
                    || entry?.content?.itemContent?.userResults?.result
                    || entry?.content?.content?.user_results?.result;
                const user = legacyUserFromGraph(result);
                if (user) users.push(user);
            }
            const bottom = entries.find((e) => e.entryId && (e.entryId.startsWith("cursor-bottom-") || e.entryId.startsWith("sq-cursor-bottom-")))?.content?.value;
            return {
                users,
                next_cursor: 0,
                next_cursor_str: bottom || "0",
                previous_cursor: 0,
                previous_cursor_str: "0",
            };
        },
    },
    {
        path: "/1.1/lists/members/create.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "-Kf1YVC1rNKkPvPFk7YXZw";
            xhr.storage.operation = "ListAddMember";
            xhr.modUrl = `${NEW_API}/-Kf1YVC1rNKkPvPFk7YXZw/ListAddMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    {
        path: "/1.1/lists/members/destroy.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "_2o1-wSMWGFSi5HUscn1Hw";
            xhr.storage.operation = "ListRemoveMember";
            xhr.modUrl = `${NEW_API}/_2o1-wSMWGFSi5HUscn1Hw/ListRemoveMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    {
        path: "/1.1/lists/members/create_all.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.storage.queryId = "-Kf1YVC1rNKkPvPFk7YXZw";
            xhr.storage.operation = "ListAddMember";
            xhr.storage.many = true;
            xhr.modUrl = `${NEW_API}/-Kf1YVC1rNKkPvPFk7YXZw/ListAddMember`;
        },
        beforeSendHeaders: listMemberMutationHeaders,
        sendHandler: (xhr, body) => { sendListMemberMutation(xhr, body); },
        afterRequest: (xhr) => listMutationResult(xhr),
    },
    // Search
    {
        path: "/1.1/search/universal.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = {
                    rawQuery: params.get("q"),
                    count: 20,
                    querySource: "typed_query",
                    product: "Latest",
                };
                let features = {"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"tweetypie_unmention_optimization_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"rweb_video_timestamps_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_enhance_cards_enabled":false};

                xhr.storage.query = variables.rawQuery;
                xhr.storage.cursor = params.get("since_id");
                xhr.modUrl = `${NEW_API}/l0dLMlz_fHji3FT8AfrvxA/SearchTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        openHandler: (xhr, method, url, async, username, password) => {
            if(!timings.search[xhr.storage.query]) {
                timings.search[xhr.storage.query] = 0;
            }
            if(Date.now() - timings.search[xhr.storage.query] < 60000*1.5 && xhr.storage.cursor) {
                xhr.storage.cancelled = true;
            } else {
                xhr.open(method, url, async, username, password);
                timings.search[xhr.storage.query] = Date.now();
            }
        },
        sendHandler: (xhr, data) => {
            if(xhr.storage.cancelled) {
                emulateResponse(xhr);
            } else {
                xhr.send(data);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            if(xhr.storage.cancelled) {
                return [];
            }
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            // if (data.errors && data.errors[0]) {
            //     return [];
            // }
            let instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
            let entries = instructions?.find((i) => i.entries);
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let res = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("sq-I-t-") || entry.entryId.startsWith("tweet-")) {
                    let result = entry.content.itemContent.tweet_results.result;

                    if (isPromoted(entry)) {
                        continue;
                    }
                    let tweet = safeParseTweet(result);
                    if (!tweet || tweetHidden(tweet)) {
                        continue;
                    }
                    res.push(tweet);
                }
            }
            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            );
            if (cursor) {
                cursor = cursor.content.value;
            } else {
                cursor = instructions.find(
                    (e) =>
                        e.entry_id_to_replace &&
                        (e.entry_id_to_replace.startsWith("sq-cursor-bottom-") ||
                            e.entry_id_to_replace.startsWith("cursor-bottom-"))
                );
                if (cursor) {
                    cursor = cursor.entry.content.value;
                } else {
                    cursor = null;
                }
            }

            return {
                metadata: {
                    cursor,
                    refresh_interval_in_sec: 30,
                },
                modules: res.map((t) => ({ status: { data: t } })),
            };
        },
    },
    // User search
    {
        path: "/1.1/users/search.json",
        method: "GET",
        beforeRequest: (xhr) => {
            try {
                let url = new URL(xhr.modUrl);
                let params = new URLSearchParams(url.search);
                let variables = {
                    rawQuery: params.get("q"),
                    count: 20,
                    querySource: "typed_query",
                    product: "People",
                };
                let features = {
                    rweb_lists_timeline_redesign_enabled: false,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: true,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    responsive_web_twitter_article_tweet_consumption_enabled: false,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: true,
                    responsive_web_media_download_video_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                };

                xhr.modUrl = `${NEW_API}/nK1dw4oV3k4w5TdtcAdSww/SearchTimeline?${generateParams(
                    features,
                    variables
                )}`;
            } catch (e) {
                console.error(e);
            }
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return [];
            }
            if (data.errors && data.errors[0]) {
                return [];
            }
            let instructions = data.data.search_by_raw_query.search_timeline.timeline.instructions;
            let entries = instructions.find((i) => i.entries);
            if (!entries) {
                return [];
            }
            entries = entries.entries;
            let res = [];
            for (let entry of entries) {
                if (entry.entryId.startsWith("sq-I-u-") || entry.entryId.startsWith("user-")) {
                    let result = entry.content.itemContent.user_results.result;
                    if (!result || !result.legacy) {
                        console.log("Bug: no user", entry);
                        continue;
                    }
                    let user = result.legacy;
                    user.id_str = result.rest_id;
                    res.push(user);
                }
            }
            let cursor = entries.find(
                (e) =>
                    e.entryId.startsWith("sq-cursor-bottom-") ||
                    e.entryId.startsWith("cursor-bottom-")
            );
            if (cursor) {
                cursor = cursor.content.value;
            } else {
                cursor = instructions.find(
                    (e) =>
                        e.entry_id_to_replace &&
                        (e.entry_id_to_replace.startsWith("sq-cursor-bottom-") ||
                            e.entry_id_to_replace.startsWith("cursor-bottom-"))
                );
                if (cursor) {
                    cursor = cursor.entry.content.value;
                } else {
                    cursor = null;
                }
            }

            return res;
        },
    },
    // Tweet creation
    {
        path: "/1.1/statuses/update.json",
        method: "POST",
        beforeRequest: (xhr) => {
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/oB-5XsHNAbjvARJEc8CZFw/CreateTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        beforeSendBody: (xhr, body) => {
            let params = Object.fromEntries(new URLSearchParams(body));
            let variables = {
                tweet_text: params.status,
                media: {
                    media_entities: [],
                    possibly_sensitive: false,
                },
                semantic_annotation_ids: [],
                dark_request: false,
            };
            if (params.in_reply_to_status_id) {
                variables.reply = {
                    in_reply_to_tweet_id: params.in_reply_to_status_id,
                    exclude_reply_user_ids: [],
                };
                if (params.exclude_reply_user_ids) {
                    variables.reply.exclude_reply_user_ids =
                        params.exclude_reply_user_ids.split(",");
                }
            }
            if (params.media_ids) {
                variables.media.media_entities = params.media_ids
                    .split(",")
                    .map((id) => ({ media_id: id, tagged_users: [] }));
            }
            if (params.attachment_url) {
                variables.attachment_url = params.attachment_url;
            }

            return JSON.stringify({
                variables,
                features: {"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"tweetypie_unmention_optimization_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"articles_preview_enabled":true,"rweb_video_timestamps_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_enhance_cards_enabled":false},
                queryId: "oB-5XsHNAbjvARJEc8CZFw",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let tweet = parseTweet(data.data.create_tweet.tweet_results.result);
            return tweet;
        },
    },
    // Retweeting
    {
        path: /\/1.1\/statuses\/retweet\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/retweet\/(\d+).json/
            )[1];
            xhr.storage.retweeter = getCurrentUserId();
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/ojPdsZsimiJrUGLR1sjUtA/CreateRetweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] = PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            if (xhr.modReqHeaders["x-act-as-user-id"]) {
                xhr.storage.retweeter = xhr.modReqHeaders["x-act-as-user-id"];
            }
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: {
                    tweet_id: xhr.storage.tweet_id,
                    dark_request: false,
                },
                queryId: "ojPdsZsimiJrUGLR1sjUtA",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let res = data.data.create_retweet.retweet_results.result;
            let tweet = res.legacy;
            tweet.id_str = res.rest_id;
            if (!tweet.user) {
                tweet.user = {
                    id_str: xhr.storage.retweeter,
                };
            }
            return tweet;
        },
    },
    // Unretweeting
    {
        path: /\/1.1\/statuses\/unretweet\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/unretweet\/(\d+).json/
            )[1];
            xhr.storage.retweeter = getCurrentUserId();
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/iQtK4dl5hBmXewYZuEOKVw/DeleteRetweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
            if (xhr.modReqHeaders["x-act-as-user-id"]) {
                xhr.storage.retweeter = xhr.modReqHeaders["x-act-as-user-id"];
            }
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: { source_tweet_id: xhr.storage.tweet_id, dark_request: false },
                queryId: "iQtK4dl5hBmXewYZuEOKVw",
            });
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let res = data.data.unretweet.source_tweet_results.result;
            let tweet = res.legacy;
            tweet.id_str = res.rest_id;
            if (!tweet.user) {
                tweet.user = {
                    id_str: xhr.storage.retweeter,
                };
            }
            return tweet;
        },
    },
    // Getting tweet details
    {
        path: /\/1.1\/statuses\/show\/(\d+).json/,
        method: "GET",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/show\/(\d+).json/
            )[1];
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/KwGBbJZc6DBx8EKmyQSP7g/TweetDetail?variables=${encodeURIComponent(
                JSON.stringify({
                    focalTweetId: xhr.storage.tweet_id,
                    with_rux_injections: false,
                    includePromotedContent: false,
                    withCommunity: true,
                    withQuickPromoteEligibilityTweetFields: true,
                    withBirdwatchNotes: true,
                    withVoice: true,
                    withV2Timeline: true,
                })
            )}&features=${encodeURIComponent(
                JSON.stringify({
                    rweb_lists_timeline_redesign_enabled: false,
                    blue_business_profile_image_shape_enabled: true,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: false,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    vibe_api_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
                    interactive_text_enabled: true,
                    responsive_web_text_conversations_enabled: false,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                })
            )}`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let ic = data.data.threaded_conversation_with_injections_v2.instructions
                .find((i) => i.type === "TimelineAddEntries")
                .entries.find((e) => e.entryId === `tweet-${xhr.storage.tweet_id}`)
                .content.itemContent;
            let res = ic.tweet_results.result;
            let tweet = parseTweet(res, { expandNotes: true });
            return tweet;
        },
    },
    {
        path: "/1.1/statuses/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.searchParams.get("id");
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/KwGBbJZc6DBx8EKmyQSP7g/TweetDetail?variables=${encodeURIComponent(
                JSON.stringify({
                    focalTweetId: xhr.storage.tweet_id,
                    with_rux_injections: false,
                    includePromotedContent: false,
                    withCommunity: true,
                    withQuickPromoteEligibilityTweetFields: true,
                    withBirdwatchNotes: true,
                    withVoice: true,
                    withV2Timeline: true,
                })
            )}&features=${encodeURIComponent(
                JSON.stringify({
                    rweb_lists_timeline_redesign_enabled: false,
                    blue_business_profile_image_shape_enabled: true,
                    responsive_web_graphql_exclude_directive_enabled: true,
                    verified_phone_label_enabled: false,
                    creator_subscriptions_tweet_preview_api_enabled: false,
                    responsive_web_graphql_timeline_navigation_enabled: true,
                    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                    tweetypie_unmention_optimization_enabled: true,
                    vibe_api_enabled: true,
                    responsive_web_edit_tweet_api_enabled: true,
                    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                    view_counts_everywhere_api_enabled: true,
                    longform_notetweets_consumption_enabled: true,
                    tweet_awards_web_tipping_enabled: false,
                    freedom_of_speech_not_reach_fetch_enabled: true,
                    standardized_nudges_misinfo: true,
                    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
                    interactive_text_enabled: true,
                    responsive_web_text_conversations_enabled: false,
                    longform_notetweets_rich_text_read_enabled: true,
                    longform_notetweets_inline_media_enabled: false,
                    responsive_web_enhance_cards_enabled: false,
                })
            )}`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return {};
            }
            if (data.errors && data.errors[0]) {
                return {};
            }
            let ic = data.data.threaded_conversation_with_injections_v2.instructions
                .find((i) => i.type === "TimelineAddEntries")
                .entries.find((e) => e.entryId === `tweet-${xhr.storage.tweet_id}`)
                .content.itemContent;
            let res = ic.tweet_results.result;
            let tweet = parseTweet(res, { expandNotes: true });
            return tweet;
        },
    },
    // Tweet deletion
    {
        path: /\/1.1\/statuses\/destroy\/(\d+).json/,
        method: "POST",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            xhr.storage.tweet_id = originalUrl.pathname.match(
                /\/1.1\/statuses\/destroy\/(\d+).json/
            )[1];
            xhr.modUrl = `https://${location.hostname}/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        beforeSendBody: (xhr, body) => {
            return JSON.stringify({
                variables: { tweet_id: xhr.storage.tweet_id, dark_request: false },
                queryId: "VaenaVgh5q5ih7kvyVjgtg",
            });
        },
    },
    // Tweet replies
    {
        path: /\/2\/timeline\/conversation\/(\d+).json/,
        method: "GET",
        beforeRequest: (xhr) => {
            let originalUrl = new URL(xhr.originalUrl);
            let params = new URLSearchParams(originalUrl.search);

            params.delete("ext");
            params.delete("include_ext_has_nft_avatar");
            params.delete("include_ext_is_blue_verified");
            params.delete("include_ext_verified_type");
            params.delete("include_ext_sensitive_media_warning");
            params.delete("include_ext_media_color");

            originalUrl.search = params.toString();

            xhr.modUrl = originalUrl.toString();
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            let data;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                console.error(e);
                return data;
            }
            if (data.errors && data.errors[0]) {
                return data;
            }
            for (let id in data.globalObjects.tweets) {
                let tweet = data.globalObjects.tweets[id];
                for (const status of [tweet, tweet.retweeted_status, tweet.quoted_status, tweet.retweeted_status?.quoted_status]) {
                    const card = parseTweetCard({ legacy: status?.card });
                    if (card) status.card = card;
                }

                if (!tweet.contributors) tweet.contributors = null;
                if (tweet.conversation_id_str)
                    tweet.conversation_id = parseInt(tweet.conversation_id_str);
                if (!tweet.coordinates) tweet.coordinates = null;
                if (!tweet.conversation_muted) tweet.conversation_muted = false;
                if (!tweet.favorited) tweet.favorited = false;
                if (!tweet.geo) tweet.geo = null;
                if (!tweet.id) tweet.id = parseInt(id);
                if (!tweet.in_reply_to_screen_name) tweet.in_reply_to_screen_name = null;
                if (!tweet.in_reply_to_status_id) tweet.in_reply_to_status_id = null;
                if (!tweet.in_reply_to_status_id_str) tweet.in_reply_to_status_id_str = null;
                if (!tweet.in_reply_to_user_id) tweet.in_reply_to_user_id = null;
                if (!tweet.in_reply_to_user_id_str) tweet.in_reply_to_user_id_str = null;
                if (!tweet.is_quote_status) tweet.is_quote_status = false;
                if (!tweet.place) tweet.place = null;
                if (!tweet.supplemental_language) tweet.supplemental_language = null;
                if (!tweet.retweeted) tweet.retweeted = false;
                if (!tweet.truncated) tweet.truncated = false;
                if (!tweet.user_id) tweet.user_id = parseInt(tweet.user_id_str);
            }

            for (let id in data.globalObjects.users) {
                let user = data.globalObjects.users[id];

                if (!user.default_profile) user.default_profile = false;
                if (!user.default_profile_image) user.default_profile_image = false;
                if (!user.entities.description) user.entities.description = { urls: [] };
                if (!user.entities.description.urls) user.entities.description.urls = [];
                if (!user.entities.url) user.entities.url = { urls: [] };
                if (!user.entities.url.urls) user.entities.url.urls = [];
                if (!user.follow_request_sent) user.follow_request_sent = false;
                if (!user.following) user.following = false;
                if (!user.has_extended_profile) user.has_extended_profile = false;
                if (!user.is_translation_enabled) user.is_translation_enabled = false;
                if (!user.is_translator) user.is_translator = false;
                if (!user.followed_by) user.followed_by = false;
                if (!user.id) user.id = parseInt(id);
                if (!user.lang) user.lang = null;
                if (!user.notifications) user.notifications = false;
                if (!user.profile_background_color) user.profile_background_color = "C0DEED";
                if (!user.profile_background_image_url)
                    user.profile_background_image_url =
                        "http://abs.twimg.com/images/themes/theme1/bg.png";
                if (!user.profile_background_image_url_https)
                    user.profile_background_image_url_https =
                        "https://abs.twimg.com/images/themes/theme1/bg.png";
                if (!user.profile_background_tile) user.profile_background_tile = false;
                if (!user.profile_link_color) user.profile_link_color = "1DA1F2";
                if (!user.profile_image_url && user.profile_image_url_https)
                    user.profile_image_url = user.profile_image_url_https.replace(
                        "https://",
                        "http://"
                    );
                if (!user.profile_sidebar_border_color)
                    user.profile_sidebar_border_color = "000000";
                if (!user.profile_sidebar_fill_color) user.profile_sidebar_fill_color = "DDEEF6";
                if (!user.profile_text_color) user.profile_text_color = "333333";
                if (!user.profile_use_background_image) user.profile_use_background_image = true;
                if (!user.protected) user.protected = false;
                if (!user.require_some_consent) user.require_some_consent = false;
                if (!user.time_zone) user.time_zone = null;
                if (!user.utc_offset) user.utc_offset = null;
                if (!user.verified) user.verified = false;
            }

            const hiddenTweetIds = new Set();
            for (const id in data.globalObjects.tweets) {
                const tweet = data.globalObjects.tweets[id];
                const author = data.globalObjects.users?.[tweet.user_id_str];
                const retweeted = tweet.retweeted_status && data.globalObjects.users?.[tweet.retweeted_status.user_id_str];
                if (userHidden(author) || userHidden(retweeted)) hiddenTweetIds.add(id);
                const quoted = tweet.quoted_status;
                const quotedUser = quoted && (data.globalObjects.users?.[quoted.user_id_str] || quoted.user);
                if (userHidden(quotedUser)) {
                    delete tweet.quoted_status;
                    tweet.is_quote_status = false;
                }
            }
            for (const id of hiddenTweetIds) delete data.globalObjects.tweets[id];

            let entries = data.timeline.instructions.find((i) => i.addEntries);
            if (entries) {
                entries.addEntries.entries = entries.addEntries.entries.filter(
                    (e) => !e.entryId.startsWith("tweetComposer-") && !hiddenTweetIds.has(e.entryId.replace(/^tweet-/, ""))
                );
                for (let entry of entries.addEntries.entries) {
                    if (entry.entryId.startsWith("conversationThread-")) {
                        let newContent = {
                            item: {
                                content: {
                                    conversationThread: {
                                        conversationComponents: [],
                                    },
                                },
                            },
                        };
                        if (entry.content.timelineModule.items)
                            for (let item of entry.content.timelineModule.items) {
                                if (item.item && item.item.content && item.item.content.tweet) {
                                    const tweetId = String(item.item.content.tweet.id_str || item.item.content.tweet.id || "");
                                    if (hiddenTweetIds.has(tweetId)) continue;
                                    newContent.item.content.conversationThread.conversationComponents.push(
                                        {
                                            conversationTweetComponent: {
                                                tweet: item.item.content.tweet,
                                            },
                                        }
                                    );
                                }
                            }
                        entry.content = newContent;
                    }
                }
            }

            return data;
        },
    },
    // getting user
    {
        path: "/1.1/account/verify_credentials.json",
        method: "GET",
        beforeRequest: (xhr) => {
            // xhr.modUrl = `https://x.com/home/`;
        },
        beforeSendHeaders: (xhr) => {
            // delete xhr.modReqHeaders["Content-Type"];
            // delete xhr.modReqHeaders["X-Twitter-Active-User"];
            // delete xhr.modReqHeaders["X-Twitter-Client-Language"];
            // delete xhr.modReqHeaders["X-Twitter-Auth-Type"];
            // delete xhr.modReqHeaders["Authorization"];
            // delete xhr.modReqHeaders["X-Csrf-Token"];
            xhr.storage.user_id = xhr.modReqHeaders["x-act-as-user-id"];
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = "en";
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];

        },
        afterRequest: (xhr) => {
            const data = JSON.parse(xhr.responseText);
            try {
                if(!xhr.storage.user_id && !data.errors) {
                    localStorage.OTDverifiedUser = JSON.stringify(data);
                    verifiedUser = data;
                    if (data.id_str) ensureAccount(data.id_str);
                } 
            } catch (e) {
                console.error('error parsing verified user', e);
            }
            return data;
        },
        // afterRequest: (xhr) => {
        //     try {
        //         const state = extractAssignedJSON(xhr.responseText);
        //         const user_id = state.session.user_id;
        //         const user = state.entities.users.entities[user_id];
        //         if(!user) {
        //             console.error(`User not found: ${JSON.stringify(state)}`);
        //             if(localStorage.OTDverifiedUser) {
        //                 try {
        //                     verifiedUser = JSON.parse(localStorage.OTDverifiedUser);
        //                     console.warn("Using verified user from localStorage");
        //                     return verifiedUser;
        //                 } catch (e) {}
        //             }
        //             throw new Error('User not found');
        //         }
        //         verifiedUser = user;
        //         localStorage.OTDverifiedUser = JSON.stringify(user);
        //         return user;
        //     } catch (e) {
        //         console.error(`Failed to get user data`, e);
        //         return null;
        //     }
        // }
    },
    // DM messages
    {
        path: /\/1.1\/dm\/conversation\/(\d+)-(\d+).json/,
        method: "GET",
        afterRequest: (xhr) => {
            return xhr.responseText.replaceAll("\\/\\/ton.twitter.com\\/1.1", "\\/\\/ton.x.com\\/i");
        }
    },
    // Inbox
    {
        path: "/1.1/dm/user_updates.json",
        method: "GET",
        afterRequest: (xhr) => {
            return xhr.responseText.replaceAll("\\/\\/ton.twitter.com\\/1.1", "\\/\\/ton.x.com\\/i");
        }
    },
    // Translating tweets
    {
        path: "/1.1/translations/show.json",
        method: "GET",
        beforeRequest: (xhr) => {
            let url = new URL(xhr.modUrl);
            let params = new URLSearchParams(url.search);
            let tweet_id = params.get("id");
            let dest = params.get("dest");
            xhr.modUrl = `https://${location.hostname}/i/api/1.1/strato/column/None/tweetId=${tweet_id},destinationLanguage=None,translationSource=Some(Google),feature=None,timeout=None,onlyCached=None/translation/service/translateTweet`;
        },
        beforeSendHeaders: (xhr) => {
            xhr.modReqHeaders["Content-Type"] = "application/json";
            xhr.modReqHeaders["X-Twitter-Active-User"] = "yes";
            xhr.modReqHeaders["X-Twitter-Client-Language"] = navigator.language.split("-")[0];
            xhr.modReqHeaders["Authorization"] =
                PUBLIC_TOKENS[0];
            delete xhr.modReqHeaders["X-Twitter-Client-Version"];
        },
        afterRequest: (xhr) => {
            const response = JSON.parse(xhr.responseText);

            return JSON.stringify({
                text: response.translation,
                entities: response.entities,
                translated_lang: response.sourceLanguage,
            });
        }
    },

    // TweetDeck state
    {
        path: "/1.1/tweetdeck/clients/blackbird/all",
        method: "GET",
        openHandler: () => {},
        sendHandler: async (xhr) => {
            // Account verification and state loading run concurrently on first login.
            // Do not build default settings until verification has supplied the ID.
            const deadline = Date.now() + 20000;
            while (!settings && !verifiedUser?.id_str) {
                if (Date.now() >= deadline) {
                    // Complete the request as an error so TweetDeck can show its
                    // normal login error instead of leaving an unresolved spinner.
                    if (xhr.storage) xhr.storage.failure = { kind: "verification-timeout" };
                    xhr._status = 503;
                    xhr._responseText = JSON.stringify({ errors: [{
                        message: "Account verification timed out. Please refresh TweetDeck.",
                    }] });
                    emulateResponse(xhr);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (verifiedUser?.id_str) ensureAccount(verifiedUser.id_str);
            emulateResponse(xhr);
        },
        afterRequest: (xhr) => {
            const state = {
                client: {
                    columns: columnIdsOfActive(),
                    mtime: new Date().toISOString(),
                    name: "blackbird",
                    settings: settings ?? {
                        account_whitelist: [`twitter:${verifiedUser.id_str}`],
                        default_account: `twitter:${verifiedUser.id_str}`,
                        recent_searches: [],
                        display_sensitive_media: false,
                        name_cache: {
                            customTimelines: {},
                            lists: {},
                            users: {}
                        },
                        navbar_width: "full-size",
                        previous_splash_version: "4.0.220811153004",
                        show_search_filter_callout: false,
                        show_trends_filter_callout: false,
                        theme: "light",
                        use_narrow_columns: null,
                        version: 2
                    },
                },
                columns: columns ?? {},
                decider: {},
                feeds: feeds ?? {},
                messages: [],
                new: true
            };
            if(!settings) {
                settings = state.client.settings;
                persistAccountState();
            }
            cleanUp();
            keepLegacyPollerCache();
            relaxLegacyExhaustion();
            tuneLegacyPolling();
            console.log('account state', state);

            return state;
        },
    },
    // emulate sending state data
    {
        path: "/1.1/tweetdeck/clients/blackbird",
        method: "POST",
        responseHeaderOverride: {
            "x-td-mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            console.log('state push', json);
            if(json.columns) {
                writeColumnIds(json.columns);
            }
            if(json.settings && settings) {
                for(let key in json.settings) {
                    settings[key] = json.settings[key];
                }
                persistAccountState();
            }
            cleanUp();
            return body;
        },
        afterRequest: (xhr) => {
            return "";
        }
    },
    // emulate sending feeds
    {
        path: "/1.1/tweetdeck/feeds",
        method: "POST",
        responseHeaderOverride: {
            "X-Td-Mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            let ids = [];
            for(let i = 0; i < json.length; i++) {
                const id = json[i].id ?? generateID();
                ids.push(id);
                feeds[id] = json[i];
            }
            xhr.storage.ids = ids;
            persistAccountState();
            console.log('feeds push', json, ids);
            return body;
        },
        afterRequest: (xhr) => {
            return xhr.storage.ids;
        }
    },
    // emulate sending columns
    {
        path: "/1.1/tweetdeck/columns",
        method: "POST",
        responseHeaderOverride: {
            "X-Td-Mtime": () => {
                return new Date().toISOString();
            },
        },
        openHandler: () => {},
        sendHandler: emulateResponse,
        beforeSendBody: (xhr, body) => {
            let json = JSON.parse(body);
            let ids = [];
            for(let i = 0; i < json.length; i++) {
                const id = json[i].id ?? generateID();
                ids.push(id);
                columns[id] = json[i];
            }
            xhr.storage.ids = ids;
            persistAccountState();
            console.log('columns push', json, ids);
            return body;
        },
        afterRequest: (xhr) => {
            return xhr.storage.ids;
        }
    },
    // tweetdeck stuff
    {
        path: "/decider",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got decider");
            return {"decider":{"tweetdeck_subsequent_follows":true,"scheduler_write":true,"in_reply_to_indicator":true,"enable_cors_firefox":true,"create_moment":true,"simplified_edit_collection_flow":true,"suggest_refresh":true,"poll_streamed_feed_favorites":true,"disable_oauth_echo":true,"scheduler_read_visible":true,"upload_big_gifs":true,"cookie_force_migrate":true,"action_retweeted_retweet":true,"native_animated_gifs":true,"touchdeck_sidebar_v2":true,"account_settings_join_team_flow":true,"enable_rewrite_columns":true,"touchdeck_font_size_v2":true,"touchdeck_search_v2":true,"disable_typeahead_search_with_feather_v2":true,"dataminr_proxied_auth_flow":true,"disable_streaming":true,"abuse_emergency_filter_info":true,"poll_streamed_feed_home":true,"compose_quoted_tweet_as_attachment":true,"send_twitter_auth_type_header":true,"dataminr":true,"heartfave_animation":true,"touchdeck_column_options_v2":true,"tweets_emoji":true,"column_unread_bar":true,"with_video_upload":true,"continuous_pipeline_staging":true,"universal_search_timelines":true,"machine_translated_tweets":true,"hashflags":true,"scheduler_read_background":true,"cookie_streaming":true,"poll_streamed_feed_usertweets":true,"faster_notifications":true,"disable_scheduled_messages":true,"streamed_chirp_lookup_metrics":true,"tweet_up_to_four_images":true,"sample_failed_requests":true,"iq_tweets":true,"add_column_by_url_query_param":true,"use_twitter_api_sync":true,"track_search_engagement":true,"quote_tweet_read":true,"cookie_access_tweetdeck":true,"account_settings_redesign":true,"windows_migration_logged_in_2":true,"tweetstorms":true,"action_favorited_retweet":true,"tweetdeck_subsequent_likes":true,"touchdeck_tweet_controls_v3":true,"trends_tailored":true,"live_video_timelines":true,"slow_collection_refresh":true,"fetch_entire_blocklist":true,"report_flow_iframe":true,"tweet_hide_suffix":true,"windows_migration_warning_2":true,"version_poll_force_upgrade":true,"quote_tweet_write":true,"poll_cards_enabled":true,"version_poll":true,"migrate_chrome_app_session_to_web":true,"add_account":true,"disable_quote_tweet_unavailable_msg":true,"convert_new_oauth_account_to_contributor":true,"iq_rts":true,"migrate_mac_app_session_to_web_gt_3_9_482":true,"enable_cors_2":true,"windows_migration_logged_out_2":true,"simplified_replies":true,"scheduler_write_media":true,"multi_photo_media_grid":true,"touchdeck_modals_v2":true,"non_destructive_chirp_rerender":true,"touchdeck_dropdowns_v2":true,"umf_prompts":true,"cramming":true,"trends_regional":true,"cookie_td_cookie_migration":true,"universal_search_timelines_by_id":true,"add_account_via_xauth_2":true,"native_video":true,"chirp_lateness_metric":true,"upload_use_sru":true,"mute_conversation":true,"action_quoted_tweet":true,"dm_rounded_avatars":true,"compose_character_limit_do_not_count_attachments":true,"touchdeck_compose_v2":true,"autocomplete_remote_sources":true,"cards_enabled_detail_view":true}};
        },
    },
    {
        path: "/web/dist/version.json",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got version.json");
            return {"version":"4.0.220811153004","minimum":"4.0.190610153508"};
        },
    },
    {
        path: "/1.1/help/settings.json",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            console.log("Got settings.json");
            return {"versions":{"feature_switches":"a6da3a3fb61e9c1423276a8df0da3258980b42cf","experiments":"a6da3a3fb61e9c1423276a8df0da3258980b42cf","settings":"a88b5266c59f52ccf8a8f1fd85f2b92a"},"config":{"live_engagement_in_column_8020":{"value":"live_engagement_enabled"},"tweetdeck_activity_streaming":{"value":false},"tweetdeck_content_render_search_tweets":{"value":true},"tweetdeck_live_engagements":{"value":true},"tweetdeck_scheduled_new_api":{"value":true},"tweetdeck_trends_column":{"value":true},"twitter_text_emoji_counting_enabled":{"value":true}},"impression_pointers":{}};
        },
    },
    {
        path: "/i/jot",
        method: "GET",
        openHandler: () => {},
        sendHandler: emulateResponse,
        afterRequest: (xhr) => {
            return "";
        },
    },
];

// wrap the XMLHttpRequest
XMLHttpRequest = function () {
    return new Proxy(new OriginalXHR(), {
        open(method, url, async, username = null, password = null) {
            this.modMethod = method;
            this.modUrl = url;
            this.originalUrl = url;
            this.modReqHeaders = {};
            this.storage = {};


            try {
                let parsedUrl = new URL(url);
                this.proxyRoute = proxyRoutes.find((route) => {
                    if(!route) return false;
                    if (route.method.toUpperCase() !== method.toUpperCase()) return false;
                    if (typeof route.path === "string") {
                        return route.path === parsedUrl.pathname;
                    } else if (route.path instanceof RegExp) {
                        return route.path.test(parsedUrl.pathname);
                    }
                });
            } catch (e) {
                console.error(e);
            }
            if (this.proxyRoute && this.proxyRoute.beforeRequest) {
                this.proxyRoute.beforeRequest(this);
            }

            // both handlers must be set, because if openHandler never opens the request 'send' will always error
            if(this.proxyRoute && this.proxyRoute.openHandler && this.proxyRoute.sendHandler) {
                this.proxyRoute.openHandler(this, this.modMethod, this.modUrl, async, username, password);
            } else {
                this.open(this.modMethod, this.modUrl, async, username, password);
            }
        },
        setRequestHeader(name, value) {
            this.modReqHeaders[name] = value;
        },
        async send(body = null) {
            // The route may still need the headers legacy set after open() (the acting account)
            // to finish its URL, so it gets one last look before anything is sent.
            if (this.proxyRoute && this.proxyRoute.beforeSend) {
                try {
                    this.proxyRoute.beforeSend(this);
                } catch (e) {
                    console.error(e);
                    this.storage.cancelled = true;
                    this._status = 503;
                }
            }
            rememberStartupRequest(this);
            watchStartup();
            let parsedUrl = new URL(this.modUrl);
            let method = this.modMethod;
            if(!method) {
                method = "GET";
            } else {
                method = method.toUpperCase();
            }
            if(
                this.readyState === 1 &&
                (
                    this.modUrl.includes("api.twitter.com") || 
                    this.modUrl.includes("api.x.com") || 
                    this.modUrl.includes("twitter.com/i/api") ||
                    this.modUrl.includes("x.com/i/api")
                )
            ) {
                if(localStorage.device_id) this.setRequestHeader('X-Client-UUID', localStorage.device_id);
                if(Date.now() - OTD_INIT_TIME < 3000 && !window.solveChallenge) {
                    console.log('waiting for challenge');
                    let i = 0;
                    while(!window.solveChallenge && i++ < 50) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                if(window.solveChallenge) {
                    try {
                        this.setRequestHeader('x-client-transaction-id', await solveChallenge(parsedUrl.pathname, method));
                    } catch (e) {
                        // Rethrowing leaves the XHR neither sent nor finished. Legacy has no
                        // timeout, so the column stays on "Loading…". Complete it as a failure.
                        console.error(`Challenge error for ${method} ${parsedUrl.pathname}:`, e);
                        failWithoutRequest(this, `challenge solver failed for ${method} ${parsedUrl.pathname}`);
                        this.storage.failure = { kind: "solver", detail: String(e) };
                        emulateResponse(this);
                        return;
                    }
                }
            }
            if (this.proxyRoute && this.proxyRoute.beforeSendHeaders) {
                this.proxyRoute.beforeSendHeaders(this);
            }
            try {
                for (const [name, value] of Object.entries(this.modReqHeaders)) {
                    this.setRequestHeader(name, value);
                }
            } catch(e) {
                if(!String(e).includes('OPENED')) {
                    console.error(e);
                }
            }
            if (this.proxyRoute && this.proxyRoute.beforeSendBody) {
                body = this.proxyRoute.beforeSendBody(this, body);
            }
            if(this.proxyRoute && this.proxyRoute.sendHandler) {
                this.proxyRoute.sendHandler(this, body);
            } else {
                this.send(body);
            }
        },
        get(xhr, key) {
            if (!key in xhr) return undefined;
            if (
                (key === "status" || key === "statusText" || key === "responseText") &&
                xhr.readyState === 4 && !xhr._inspected &&
                xhr.proxyRoute && xhr.proxyRoute.inspectResponse
            ) {
                // Legacy reads status before responseText, so a route that wants to fail a 200
                // whose body is only an error looks at the response here, once, before either.
                xhr._inspected = true;
                try {
                    xhr.proxyRoute.inspectResponse(xhr);
                } catch (e) {
                    console.error(e);
                }
            }
            if (key === "status" && !xhr._failureChecked && (xhr.readyState === 4 || xhr._readyState === 4)) {
                xhr._failureChecked = true;
                try {
                    noteRequestFailure(xhr, failureFromStatus(xhr));
                } catch (e) {
                    console.error(e);
                }
            }
            if (key === "responseText" && xhr._responseText) return xhr._responseText;
            if (key === "responseText") return this.interceptResponseText(xhr);
            if (key === "readyState" && xhr._readyState) return xhr._readyState;
            if (key === "status" && xhr._status) return xhr._status;
            if (key === "statusText" && (xhr._statusText || xhr._status)) return xhr._statusText ? xhr._statusText : xhr._status+"";

            let value = xhr[key];
            if (typeof value === "function") {
                value = this[key] || value;
                return (...args) => value.apply(xhr, args);
            } else {
                return value;
            }
        },
        set(xhr, key, value) {
            if (key in xhr) {
                xhr[key] = value;
            }
            return value;
        },
        interceptResponseText(xhr) {
            if (xhr.proxyRoute && xhr.proxyRoute.afterRequest) {
                let out;
                try {
                    out = xhr.proxyRoute.afterRequest(xhr);
                } catch (e) {
                    // jQuery reads responseText after detaching its handlers, so a throw here (a
                    // 429 or an HTML error page that is not JSON) left the request unfinished for
                    // good: the startup spinner, or "Loading…" in a column. A body that is not
                    // JSON makes jQuery fail the request as a parse error instead.
                    console.error(`OldTweetDeck: could not read the response for ${xhr.modUrl}`, e);
                    noteRequestFailure(xhr, { kind: "unreadable", status: xhr._status || xhr.status });
                    return "OldTweetDeck: unreadable response";
                }
                if (typeof out === "object") {
                    return JSON.stringify(out);
                } else {
                    return out;
                }
            }
            return xhr.responseText;
        },
        getResponseHeader(name) {
            let override = this.responseHeaderOverride ? this.responseHeaderOverride : this.proxyRoute ? this.proxyRoute.responseHeaderOverride : undefined;
            if(this.proxyRoute && override) {
                for(let header in override) {
                    if(header.toLowerCase() === name.toLowerCase()) {
                        return override[header](this.getResponseHeader(header));
                    }
                }
            }
            return this.getResponseHeader(name);
        },
        getAllResponseHeaders() {
            let headers = this.getAllResponseHeaders();

            let override = this.responseHeaderOverride ? this.responseHeaderOverride : this.proxyRoute ? this.proxyRoute.responseHeaderOverride : undefined;
            if (this.proxyRoute && override) {
                let splitHeaders = headers.split("\r\n");
                let objHeaders = {};
                for (let header of splitHeaders) {
                    let splitHeader = header.split(": ");
                    let headerName = splitHeader[0];
                    let headerValue = splitHeader[1];
                    objHeaders[headerName.toLowerCase()] = headerValue;
                }
                for(let header in override) {
                    objHeaders[header.toLowerCase()] = override[header](objHeaders[header.toLowerCase()], objHeaders);
                }
                headers = Object.entries(objHeaders).filter(([_, value]) => value).map(([name, value]) => `${name}: ${value}`).join("\r\n");
            }

            return headers;
        },
    });
};
