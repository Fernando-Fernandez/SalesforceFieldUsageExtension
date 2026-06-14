
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
const tabSessionStorage = chrome.storage?.session || chrome.storage?.local;
const reportStorage = chrome.storage?.session || chrome.storage?.local;

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
    console.log( "Getting session for url: ", requestedTabUrl );

    // first, get org id from unsecure cookie
    console.log( "Sender: ", sender );
    console.log( "Sender.tab: ", sender.tab );
    let cookieDetails = { name: "sid"
                        , url: message.url
                        , storeId: sender.tab.cookieStoreId 
                    };
    console.log( "Getting cookie: ", cookieDetails );
    chrome.cookies.get( cookieDetails, cookie => {
        if( ! cookie ) {
            responseCallback( null );
            return;
        }

        // try getting all secure cookies from salesforce.com and find the one matching our org id
        // (we may have more than one org open in different tabs or cookies from past orgs/sessions)
        let orgId = parseOrgIdFromCookie( cookie.value );
        if( ! orgId ) {
            responseCallback( null );
            return;
        }
        let secureCookieDetails = { name: "sid"
                                    , domain: "salesforce.com"
                                    , secure: true
                                    , storeId: sender.tab.cookieStoreId
                                };
        chrome.cookies.getAll( secureCookieDetails, cookies => {
            // find the cookie for our org
            let sessionCookie = findSessionCookieForOrg( cookies, orgId );
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
