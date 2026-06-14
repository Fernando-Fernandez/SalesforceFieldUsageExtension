// Content script for Salesforce pages: confirms a Salesforce page is open, obtains
// the host/session from the background worker, and answers the popup's request for
// the org's queryable SObjects via the REST API.

const GETHOSTANDSESSION = "getHostSession";
const GET_SOBJECTS = "getSObjects";
// Fallback until the newest version is discovered from /services/data/.
const DEFAULT_DATA_API_VERSION = 'v60.0';

let sfHost, sessionId;
let dataApiVersion = DEFAULT_DATA_API_VERSION;

chrome.runtime.onMessage.addListener( ( message, sender, sendResponse ) => {
    if( message?.type === GET_SOBJECTS ) {
        handleSObjectListRequest( sendResponse );
        return true;
    }
} );

// only execute event setup if within a Salesforce page
let sfElement = document.querySelector( "body.sfdcBody, body.ApexCSIPage, #auraLoadingBox" );
if( sfElement ) {
    // get host and session from background script
    let getHostMessage = { message: GETHOSTANDSESSION
        , url: location.href 
    };
    chrome.runtime.sendMessage( getHostMessage, resultData => {
        //console.log( resultData );
        sfHost = resultData.domain;
        sessionId = resultData.session;
    } );

}

function handleSObjectListRequest( sendResponse ) {
    ensureSession()
        .then( () => ensureApiVersion() )
        .then( () => fetchSObjectsList() )
        .then( sobjects => {
            sendResponse( { sobjects } );
        } ).catch( error => {
            console.error( "Unable to retrieve SObjects", error );
            sendResponse( { error: error.message } );
        } );
}

// Discovers the newest API version once per page, reusing the shared selector.
// Best-effort: any failure leaves the default version in place.
function ensureApiVersion() {
    const pick = globalThis.SFUsageCore?.pickLatestApiVersion;
    if( !pick ) {
        return Promise.resolve();
    }
    let endpoint = "https://" + sfHost + "/services/data/";
    return fetch( endpoint, buildRequest() )
        .then( response => response.ok ? response.json() : null )
        .then( versions => {
            if( Array.isArray( versions ) ) {
                dataApiVersion = pick( versions, DEFAULT_DATA_API_VERSION );
            }
        } )
        .catch( () => { /* keep the default version */ } );
}

function buildRequest() {
    return {
        method: "GET"
        , headers: {
          "Content-Type": "application/json"
          , "Authorization": "Bearer " + sessionId
        }
    };
}

function ensureSession() {
    if( sfHost && sessionId ) {
        return Promise.resolve();
    }
    return new Promise( ( resolve, reject ) => {
        let getHostMessage = { message: GETHOSTANDSESSION
            , url: location.href 
        };
        chrome.runtime.sendMessage( getHostMessage, resultData => {
            if( ! resultData ) {
                reject( new Error( "Unable to fetch Salesforce session." ) );
                return;
            }
            sfHost = resultData.domain;
            sessionId = resultData.session;
            resolve();
        } );
    } );
}

function fetchSObjectsList() {
    let endpoint = "https://" + sfHost + "/services/data/" + dataApiVersion + "/sobjects";
    return fetch( endpoint, buildRequest() )
        .then( response => {
            if( ! response.ok ) {
                return response.text().then( text => {
                    throw new Error( "Salesforce API error (" + response.status + "): " + text );
                } );
            }
            return response.json();
        } )
        .then( data => {
            let sobjects = data.sobjects ?? [];
            return sobjects
                .filter( obj => obj.queryable )
                .map( obj => ( { name: obj.name, label: obj.label } ) );
        } );
}
