
// usage-core.js attaches its API to the global scope (it ships no ES exports so it
// can also load as a classic <script> in the popup/report pages and as a CommonJS
// module under node:test). importScripts is the reliable way to pull it into a
// classic service worker; this requires the background worker to NOT be type:module.
importScripts( "./lib/usage-core.js" );
if( !globalThis.SFUsageCore ) {
    throw new Error( "usage-core.js failed to load in the service worker." );
}
const {
    parseOrgIdFromCookie,
    findSessionCookieForOrg,
    serializeTabSessions,
    deserializeTabSessions,
    pruneReportStore
} = globalThis.SFUsageCore;

const GETHOSTANDSESSION = "getHostSession";
const INVALIDATE_SESSION = "invalidateSession";
const STORE_REPORT_DATA = "storeReportData";
const GET_REPORT_DATA = "getReportData";
const tabSessionMap = new Map();
const TAB_SESSION_STORAGE_KEY = "tabSessionCache";
const REPORT_STORE_KEY = "reportDataStore";
// Reports are kept in session storage (survives service-worker restarts, cleared
// when the browser closes) rather than an in-memory Map, so opening or refreshing
// the report tab works even after the worker has been torn down. Capped so a long
// session does not accumulate unbounded report payloads.
const MAX_STORED_REPORTS = 10;
// Session storage only (never chrome.storage.local): session ids and cached report
// data are sensitive and must not be written to disk where they would outlive the
// browser session. These are in-memory, cleared when the browser closes.
const tabSessionStorage = chrome.storage?.session;
const reportStorage = chrome.storage?.session;
// Secure "sid" cookies are searched on these base domains in order; the first that
// yields a cookie matching the org wins. salesforce.com covers commercial orgs.
// Government Cloud orgs would need their base domain (e.g. "salesforce.mil") added
// here AND to host_permissions in manifest.json.
const SESSION_COOKIE_DOMAINS = [ "salesforce.com", "cloudforce.com" ];

hydrateTabSessions();

// message handler to retrieve host and session id from Salesforce cookies
chrome.runtime.onMessage.addListener( ( message, sender, responseCallback ) => {
    if( message.message == GETHOSTANDSESSION ) {
        getHostAndSession( message, sender, responseCallback );
        return true;
    }

    if( message.message === INVALIDATE_SESSION ) {
        invalidateTabSession( message.tabUrl, responseCallback );
        return true;
    }

    if( message.type === STORE_REPORT_DATA ) {
        storeReportData( message.data, responseCallback );
        return true;
    }

    if( message.type === GET_REPORT_DATA ) {
        getStoredReportData( message.reportId, responseCallback );
        return true;
    }

    return false;
});


async function hydrateTabSessions() {
    if( !tabSessionStorage?.get ) {
        return;
    }
    try {
        const stored = await tabSessionStorage.get( TAB_SESSION_STORAGE_KEY );
        const entries = stored?.[ TAB_SESSION_STORAGE_KEY ];
        deserializeTabSessions( entries ).forEach( entry => {
            tabSessionMap.set( entry.tabUrl, { domain: entry.domain, session: entry.session } );
        } );
    } catch( error ) {
        console.warn( "Unable to hydrate tab session cache.", error );
    }
}

function persistTabSessions() {
    if( !tabSessionStorage?.set ) {
        return;
    }
    const serialized = serializeTabSessions( tabSessionMap );
    tabSessionStorage.set( { [ TAB_SESSION_STORAGE_KEY ]: serialized } ).catch( error => {
        console.warn( "Unable to persist tab session cache.", error );
    } );
}

function getHostAndSession( message, sender, responseCallback ) {
    // check cache first and return if found
    const requestedTabUrl = message.tabUrl;
    if( requestedTabUrl && tabSessionMap.has( requestedTabUrl ) ) {
        responseCallback( tabSessionMap.get( requestedTabUrl ) );
        return;
    }

    // first, get org id from the cookie set for the current page
    let storeId = sender?.tab?.cookieStoreId;
    let cookieDetails = { name: "sid"
                        , url: message.url
                        , storeId
                    };
    chrome.cookies.get( cookieDetails, cookie => {
        if( ! cookie ) {
            responseCallback( null );
            return;
        }

        // find the secure session cookie matching our org id across the known base
        // domains (we may have more than one org open, or stale cookies from past sessions)
        let orgId = parseOrgIdFromCookie( cookie.value );
        if( ! orgId ) {
            responseCallback( null );
            return;
        }

        findSecureSessionCookie( orgId, storeId, sessionCookie => {
            if( ! sessionCookie ) {
                responseCallback( null );
                return;
            }

            // cache session for this tab url
            let tabUrl = sender?.tab?.url;
            if( tabUrl ) {
                tabSessionMap.set( tabUrl, { domain: sessionCookie.domain, session: sessionCookie.value } );
                persistTabSessions();
            }

            responseCallback( { domain: sessionCookie.domain
                                , session:  sessionCookie.value
                            } );
        });
    });
}

// Searches the configured base domains in order for a secure "sid" cookie matching
// the org, invoking callback with the first match (or null when none is found).
function findSecureSessionCookie( orgId, storeId, callback, domainIndex = 0 ) {
    if( domainIndex >= SESSION_COOKIE_DOMAINS.length ) {
        callback( null );
        return;
    }
    let secureCookieDetails = { name: "sid"
                                , domain: SESSION_COOKIE_DOMAINS[ domainIndex ]
                                , secure: true
                                , storeId
                            };
    chrome.cookies.getAll( secureCookieDetails, cookies => {
        let sessionCookie = findSessionCookieForOrg( cookies, orgId );
        if( sessionCookie ) {
            callback( sessionCookie );
            return;
        }
        findSecureSessionCookie( orgId, storeId, callback, domainIndex + 1 );
    });
}

// Drops a cached session so the next lookup re-reads it from cookies. Called when
// a consumer sees an expired-session response (HTTP 401) and wants a fresh token.
function invalidateTabSession( tabUrl, responseCallback ) {
    if( tabUrl && tabSessionMap.has( tabUrl ) ) {
        tabSessionMap.delete( tabUrl );
        persistTabSessions();
    }
    responseCallback?.( { success: true } );
}

async function readReportStore() {
    if( !reportStorage?.get ) {
        return {};
    }
    const stored = await reportStorage.get( REPORT_STORE_KEY );
    const store = stored?.[ REPORT_STORE_KEY ];
    return ( store && typeof store === "object" ) ? store : {};
}

async function storeReportData( data, responseCallback ) {
    if( !data || !data.reportId ) {
        responseCallback( { success: false, error: "Invalid report payload." } );
        return;
    }
    try {
        const existing = await readReportStore();
        const next = pruneReportStore( { ...existing, [ data.reportId ]: data }, MAX_STORED_REPORTS );
        await reportStorage.set( { [ REPORT_STORE_KEY ]: next } );
        responseCallback( { success: true } );
    } catch( error ) {
        console.warn( "Unable to store report data.", error );
        responseCallback( { success: false, error: error?.message || String( error ) } );
    }
}

async function getStoredReportData( reportId, responseCallback ) {
    if( !reportId ) {
        responseCallback( { success: false, error: "Missing report id." } );
        return;
    }
    try {
        const store = await readReportStore();
        // Intentionally non-destructive: leaving the entry in place lets the report
        // tab be refreshed or reopened. Old reports are evicted by pruneReportStore.
        const data = store[ reportId ] || null;
        responseCallback( { success: !!data, data, error: data ? null : "Report not found." } );
    } catch( error ) {
        console.warn( "Unable to read report data.", error );
        responseCallback( { success: false, error: error?.message || String( error ) } );
    }
}
