// checks whether a Salesforce page is open
// then fetches session id from cookie
// then calls tooling API to get flow definition
// then creates mouse over event handlers on each of the flow elements
// the handlers will display a tooltip with information from the element found in the flow definition

const GETHOSTANDSESSION = "getHostSession";
const GET_SOBJECTS = "getSObjects";
const DATA_API_VERSION = 'v57.0';

let sfHost, sessionId;

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
    ensureSession().then( () => {
        return fetchSObjectsList();
    } ).then( sobjects => {
        sendResponse( { sobjects } );
    } ).catch( error => {
        console.error( "Unable to retrieve SObjects", error );
        sendResponse( { error: error.message } );
    } );
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
    let endpoint = "https://" + sfHost + "/services/data/" + DATA_API_VERSION + "/sobjects";
    let request = {
        method: "GET"
        , headers: {
          "Content-Type": "application/json"
          , "Authorization": "Bearer " + sessionId
        }
    };
    return fetch( endpoint, request )
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
