
const GETHOSTANDSESSION = "getHostSession";
const STORE_REPORT_DATA = "storeReportData";
const GET_REPORT_DATA = "getReportData";
const tabSessionMap = new Map();
const reportDataStore = new Map();

// message handler to retrieve host and session id from Salesforce cookies
chrome.runtime.onMessage.addListener( ( message, sender, responseCallback ) => {
    if( message.message == GETHOSTANDSESSION ) {
        getHostAndSession( message, sender, responseCallback );
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


function getHostAndSession( message, sender, responseCallback ) {
    // check cache first and return if found
    const requestedTabUrl = message.tabUrl;
    if( requestedTabUrl && tabSessionMap.has( requestedTabUrl ) ) {
        responseCallback( tabSessionMap.get( requestedTabUrl ) );
        return;
    }

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
        let [ orgId ] = cookie.value.split( "!" );
        let secureCookieDetails = { name: "sid"
                                    , domain: "salesforce.com"
                                    , secure: true
                                    , storeId: sender.tab.cookieStoreId 
                                };
        chrome.cookies.getAll( secureCookieDetails, cookies => {
            // find the cookie for our org
            let sessionCookie = cookies.find( c => c.value.startsWith( orgId + "!" ) );
            if( ! sessionCookie ) {
                responseCallback( null );
                return;
            }

            // cache session for this tab url
            let tabUrl = sender?.tab?.url;
            if( tabUrl ) {
                tabSessionMap.set( tabUrl, { domain: sessionCookie.domain, session: sessionCookie.value } );
            }

            responseCallback( { domain: sessionCookie.domain 
                                , session:  sessionCookie.value
                            } );
        });
    });
}

function storeReportData( data, responseCallback ) {
    if( !data || !data.reportId ) {
        responseCallback( { success: false, error: "Invalid report payload." } );
        return;
    }
    reportDataStore.set( data.reportId, data );
    responseCallback( { success: true } );
}

function getStoredReportData( reportId, responseCallback ) {
    if( !reportId ) {
        responseCallback( { success: false, error: "Missing report id." } );
        return;
    }
    let data = reportDataStore.get( reportId );
    if( data ) {
        reportDataStore.delete( reportId );
    }
    responseCallback( { success: !!data, data, error: data ? null : "Report not found." } );
}
