import { html } from 'lit-element';
import { unsafeHTML } from 'lit-html/directives/unsafe-html';
import marked from 'marked';

function onApiKeyChange(apiKeyId, e) {
  let apiKeyValue = '';
  const securityObj = this.resolvedSpec.securitySchemes.find((v) => (v.apiKeyId === apiKeyId));
  if (securityObj) {
    const trEl = e.target.closest('tr');
    if (securityObj.type && securityObj.scheme && securityObj.type === 'http' && securityObj.scheme.toLowerCase() === 'basic') {
      const userVal = trEl.querySelector('.api-key-user').value.trim();
      const passwordVal = trEl.querySelector('.api-key-password').value.trim();
      if (userVal && passwordVal) {
        apiKeyValue = `Basic ${btoa(`${userVal}:${passwordVal}`)}`;
      }
    } else {
      apiKeyValue = trEl.querySelector('.api-key-input').value.trim();
      if (apiKeyValue) {
        if (securityObj.scheme && securityObj.scheme.toLowerCase() === 'bearer') {
          apiKeyValue = `Bearer ${apiKeyValue}`;
        }
      }
    }
    securityObj.finalKeyValue = apiKeyValue;
  }
  this.requestUpdate();
}

function onClearAllApiKeys() {
  this.resolvedSpec.securitySchemes.forEach((v) => {
    v.user = '';
    v.password = '';
    v.value = '';
    v.finalKeyValue = '';
  });
  this.requestUpdate();
}

// Updates the OAuth Access Token (API key), so it reflects in UI and gets used in TRY calls
function updateOAuthKey(apiKeyId, tokenType = 'Bearer', accessToken) {
  const securityObj = this.resolvedSpec.securitySchemes.find((v) => (v.apiKeyId === apiKeyId));
  securityObj.finalKeyValue = `${tokenType} ${accessToken}`;
  this.requestUpdate();
}

/* eslint-disable no-console */
// Gets Access-Token in exchange of Authorization Code
async function fetchAccessToken(tokenUrl, clientId, clientSecret, redirectUrl, grantType, authCode, apiKeyId, authFlowDivEl) {
  const respDisplayEl = authFlowDivEl ? authFlowDivEl.querySelector('.oauth-resp-display') : undefined;
  const urlFormParams = new URLSearchParams();
  urlFormParams.append('grant_type', grantType);
  if (authCode) {
    urlFormParams.append('code', authCode);
  }
  urlFormParams.append('client_id', clientId);
  urlFormParams.append('client_secret', clientSecret);
  urlFormParams.append('redirect_uri', redirectUrl);

  try {
    const resp = await fetch(tokenUrl, { method: 'POST', body: urlFormParams });
    const tokenResp = await resp.json();
    if (resp.ok) {
      if (tokenResp.token_type && tokenResp.access_token) {
        updateOAuthKey.call(this, apiKeyId, tokenResp.token_type, tokenResp.access_token);
        if (respDisplayEl) {
          respDisplayEl.innerHTML = '<span style="color:var(--green)">Access Token Received</span>';
        }
        return true;
      }
    } else {
      if (respDisplayEl) {
        respDisplayEl.innerHTML = `<span style="color:var(--red)">${tokenResp.error_description || tokenResp.error_description || 'Unable to get access token'}</span>`;
      }
      return false;
    }
  } catch (err) {
    if (respDisplayEl) {
      respDisplayEl.innerHTML = '<span style="color:var(--red)">Failed to get access token</span>';
    }
    return false;
  }
}

// Gets invoked when it receives the Authorization Code from the other window via message-event
async function onWindowMessageEvent(msgEvent, winObj, tokenUrl, clientId, clientSecret, redirectUrl, grantType, apiKeyId, authFlowDivEl) {
  sessionStorage.removeItem('winMessageEventActive');
  winObj.close();
  if (msgEvent.data.fake) {
    return;
  }
  if (!msgEvent.data) {
    console.warn('RapiDoc: Received no data with authorization message');
  }
  if (msgEvent.data.error) {
    console.warn('RapiDoc: Error while receiving data');
  }
  if (msgEvent.data) {
    if (msgEvent.data.responseType === 'code') {
      // Authorization Code flow
      fetchAccessToken.call(this, tokenUrl, clientId, clientSecret, redirectUrl, grantType, msgEvent.data.code, apiKeyId, authFlowDivEl);
    } else if (msgEvent.data.responseType === 'token') {
      // Implicit flow
      updateOAuthKey.call(this, apiKeyId, msgEvent.data.token_type, msgEvent.data.access_token);
    }
  }
}


async function onInvokeOAuthFlow(apiKeyId, flowType, authUrl, tokenUrl, e) {
  const authFlowDivEl = e.target.closest('.oauth-flow');
  const clientId = authFlowDivEl.querySelector('.oauth-client-id') ? authFlowDivEl.querySelector('.oauth-client-id').value.trim() : '';
  const clientSecret = authFlowDivEl.querySelector('.oauth-client-secret') ? authFlowDivEl.querySelector('.oauth-client-secret').value.trim() : '';
  const checkedScopeEls = [...authFlowDivEl.querySelectorAll('input[type="checkbox"]:checked')];
  const state = (`${Math.random().toString(36)}random`).slice(2, 9);
  const redirectUrlObj = new URL(`${window.location.origin}${window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'))}/${this.oauthReceiver}`);
  let grantType = '';
  let responseType = '';
  let newWindow;

  // clear previous error messages
  const errEls = [...authFlowDivEl.parentNode.querySelectorAll('.oauth-resp-display')];
  errEls.forEach((v) => { v.innerHTML = ''; });

  if (flowType === 'authorizationCode' || flowType === 'implicit') {
    const authUrlObj = new URL(authUrl);
    if (flowType === 'authorizationCode') {
      grantType = 'authorization_code';
      responseType = 'code';
    } else if (flowType === 'implicit') {
      responseType = 'token';
    }
    const authCodeParams = new URLSearchParams(authUrl.search);
    const selectedScopes = checkedScopeEls.map((v) => v.value).join(' ');
    if (selectedScopes) {
      authCodeParams.set('scope', selectedScopes);
    }
    authCodeParams.set('client_id', clientId);
    authCodeParams.set('redirect_uri', redirectUrlObj.toString());
    authCodeParams.set('response_type', responseType);
    authCodeParams.set('state', state);
    authCodeParams.set('show_dialog', true);
    authUrlObj.search = authCodeParams.toString();
    // If any older message-event-listener is active then fire a fake message to remove it (these are single time listeners)
    if (sessionStorage.getItem('winMessageEventActive') === 'true') {
      window.postMessage({ fake: true }, this);
    }
    setTimeout(() => {
      newWindow = window.open(authUrlObj.toString());
      if (!newWindow) {
        console.error(`RapiDoc: Unable to open ${authUrlObj.toString()} in a new window`);
      } else {
        sessionStorage.setItem('winMessageEventActive', 'true');
        window.addEventListener(
          'message',
          (msgEvent) => onWindowMessageEvent.call(this, msgEvent, newWindow, tokenUrl, clientId, clientSecret, redirectUrlObj.toString(), grantType, apiKeyId, authFlowDivEl),
          { once: true },
        );
      }
    }, 10);
  } else if (flowType === 'clientCredentials') {
    grantType = 'client_credentials';
    fetchAccessToken.call(this, tokenUrl, clientId, clientSecret, redirectUrlObj.toString(), grantType, '', apiKeyId, authFlowDivEl);
  }
}
/* eslint-enable no-console */

/* eslint-disable indent */

function oAuthFlowTemplate(flowName, clientId, clientSecret, apiKeyId, authFlow) {
  let authSite = '';
  let flowNameDisplay;
  if (flowName === 'authorizationCode') {
    flowNameDisplay = 'Authorization Code Flow';
  } else if (flowName === 'clientCredentials') {
    flowNameDisplay = 'Client Credentials Flow';
  } else if (flowName === 'implicit') {
    flowNameDisplay = 'Implicit Flow';
  } else if (flowName === 'password') {
    flowNameDisplay = 'Password Flow';
  } else {
    flowNameDisplay = flowName;
  }
  try {
    authSite = new URL(authFlow.authorizationUrl).origin;
  } catch (e) {
    authSite = authFlow.authorizationUrl;
  }
  return html`
    <div class="oauth-flow" style="padding: 10px 0; margin-bottom:10px;"> 
      <div class="tiny-title upper" style="margin-bottom:5px;">${flowNameDisplay}</div> 
      ${authFlow.authorizationUrl
        ? html`<div><span style="width:75px; display: inline-block;">Auth URL</span> <span class="mono-font"> ${authFlow.authorizationUrl} </span></div>`
        : ''
      }
      ${authFlow.tokenUrl
        ? html`<div><span style="width:75px; display: inline-block;">Token URL</span> <span class="mono-font">${authFlow.tokenUrl}</span></div>`
        : ''
      }
      ${authFlow.refreshUrl
        ? html`<div><span style="width:75px; display: inline-block;">Refresh URL</span> <span class="mono-font">${authFlow.refreshUrl}</span></div>`
        : ''
      }
      ${flowName === 'authorizationCode' || flowName === 'clientCredentials' || flowName === 'implicit' || flowName === 'password'
        ? html`
          ${authFlow.scopes
            ? html`
              <span> Scopes </span>
              <div class= "oauth-scopes" style = "width:100%; display:flex; flex-direction:column; flex-wrap:wrap; margin:0 0 10px 24px">
                ${Object.entries(authFlow.scopes).map((scopeAndDescr, index) => html`
                  <div class="m-checkbox" style="display:inline-block">
                    <input type="checkbox" id="${flowName}${index}" value="${scopeAndDescr[0]}">
                    <label for="${flowName}${index}">
                      <span class="mono-font">${scopeAndDescr[0]}</span>
                        ${scopeAndDescr[0] !== scopeAndDescr[1] ? ` - ${scopeAndDescr[1] || ''}` : ''}
                    </label>
                  </div>
                `)}
              </div>
            `
            : ''
          }
          <div style="display:flex; max-height:28px;">
            <input type="text" value = "${clientId}" placeholder="client-id" spellcheck="false" class="oauth-client-id">
            ${flowName === 'authorizationCode' || flowName === 'clientCredentials' || flowName === 'password'
              ? html`
                <input type="password" value = "${clientSecret}" placeholder="client-secret" spellcheck="false" class="oauth-client-secret" style = "margin:0 5px;">`
              : html`<div style='width:5px'></div>`
            }
            ${flowName === 'authorizationCode' || flowName === 'clientCredentials' || flowName === 'implicit'
              ? html`
                <button class="m-btn thin-border"
                  @click="${(e) => { onInvokeOAuthFlow.call(this, apiKeyId, flowName, authFlow.authorizationUrl, authFlow.tokenUrl, e); }}"
                > AUTHORIZE </button>`
              : ''
            }
          </div>
          ${flowName === 'password'
            ? html`
              <div style="display:flex; max-height:28px; margin-top:2px">
                <input type="text" value = "" placeholder="username" spellcheck="false" class="api-key-user">
                <input type="password" value = "" placeholder="password" spellcheck="false" class="api-key-password" style = "margin:0 5px;">
              </div>`
            : ''
          }  
          <div class="oauth-resp-display red-text small-font-size"></div>
          <!--
          <div style="margin-top:8px">
            <ul>
              ${authFlow.authorizationUrl
                ? html`
                  <li> Register this client (<span class="mono-font">${window.location.origin}</span>) with <span class="mono-font">${authSite}<span class="mono-font"> </li>
              <li> During registration, Specify redirect url pointing to <span class="mono-font">${window.location.origin}${window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'))}/${this.oauthReceiver}</span> </li>
                  <li> Create <b>${this.oauthReceiver}</b> which will receive auth-code from oAuth provider</li>
                  <li> <b>${this.oauthReceiver}</b> should contain custom-element <span class="mono-font"> &lt;oauth-receiver&gt; </span>, this element receives the auth-code and passes it to this document </li>
                  <li> After receiving auth-code, it will request access-token using <span class="mono-font"> POST ${authFlow.tokenUrl}</span>
                    <ul>
                      <li> grant_type = 'authorization_code'</li>
                      <li> code = {auth-code}</li>
                      <li> client_id = {client-id}</li>
                      <li> client_secret = {client-secret}</li>
                      <li> redirect_uri = {redirect-url}</li>
                    </ul>
                  </li>
                `
                : ''
              }
            </ul>
          </div>
          -->
          `
        : ''
      }
    </div>  
  `;
}

export default function securitySchemeTemplate() {
  const providedApiKeys = this.resolvedSpec.securitySchemes.filter((v) => (v.finalKeyValue));
  return html`
  <div id='authentication' class = 'observe-me ${this.renderStyle === 'read' ? 'section-gap--read-mode' : 'section-gap '}'>
    <div class='sub-title regular-font'> AUTHENTICATION </div>

    <div class="small-font-size" style="display:flex; align-items: center; min-height:30px">
      ${providedApiKeys.length > 0
        ? html`
          <div class="blue-text"> ${providedApiKeys.length} API key applied </div>
          <div style="flex:1"></div>
          <button class="m-btn thin-border" @click=${() => { onClearAllApiKeys.call(this); }}>CLEAR ALL API KEYS</button>`
        : html`<div class="red-text">No API key applied</div>`
      }
    </div>
    ${this.resolvedSpec.securitySchemes && this.resolvedSpec.securitySchemes.length > 0
      ? html`  
        <table class='m-table' style = "width:100%">
          ${this.resolvedSpec.securitySchemes.map((v) => html`
            <tr>  
              <td style="max-width:500px; overflow-wrap: break-word;">
                <div style="min-height:24px"> 
                  <span style="font-weight:bold">${v.type}: ${v.scheme} </span> 
                  ${v.finalKeyValue
                    ? html`
                      <span class='blue-text'>  ${v.finalKeyValue ? 'Key Applied' : ''} </span> 
                      <button class="m-btn thin-border small" @click=${() => { v.finalKeyValue = ''; this.requestUpdate(); }}>REMOVE</button>
                      `
                    : ''
                  }
                </div>
                ${v.description
                  ? html`
                    <div class="m-markdown"> 
                      ${unsafeHTML(marked(v.description || ''))}
                    </div>`
                  : ''
                }
              </td>
              <td>
                ${v.type === 'apiKey' || (v.type === 'http' && v.scheme === 'bearer')
                  ? html`
                    ${v.type === 'apiKey'
                      ? html`Send <code>${v.name}</code> in <code>${v.in}</code> with the given value`
                      : html`Send <code>Authorization</code> in <code>header</code> containing the word <code>Bearer</code> followed by a space and a Token String.`
                    }
                    <div style="display:flex;max-height:28px;">
                      <input type = "text" value = "${v.value}" class="api-key-input" placeholder = "api-token" spellcheck = "false">
                      <button class="m-btn thin-border" style = "margin-left:5px;"
                        @click="${(e) => { onApiKeyChange.call(this, v.apiKeyId, e); }}"> 
                        ${v.finalKeyValue ? 'UPDATE' : 'SET'}
                      </button>
                    </div>`
                  : ''
                }
                ${v.type === 'http' && v.scheme === 'basic'
                  ? html`
                    Send <code>Authorization</code> in <code>header</code> containing the word <code>Basic</code> followed by a space and a base64 encoded string of <code>username:password</code>.
                    <div style="display:flex; max-height:28px;">
                      <input type="text" value = "${v.user}" placeholder="username" spellcheck="false" class="api-key-user" style="width:100px">
                      <input type="password" value = "${v.password}" placeholder="password" spellcheck="false" class="api-key-password" style = "width:100px; margin:0 5px;">
                      <button class="m-btn thin-border"
                        @click="${(e) => { onApiKeyChange.call(this, v.apiKeyId, e); }}"> 
                        ${v.finalKeyValue ? 'UPDATE' : 'SET'}
                      </button>
                    </div>`
                  : ''
                }
              </td>
            </tr>
            ${v.type === 'oauth2'
              ? html`
                <tr>
                  <td colspan="2" style="border:none; padding-left:48px">
                    ${Object.keys(v.flows).map((f) => oAuthFlowTemplate.call(this, f, v.clientId, v.clientSecret, v.apiKeyId, v.flows[f]))} 
                  </td>
                </tr>    
                `
              : ''
            }    
          `)}
        </table>`
      : ''
    }
  </div>
`;
}
/* eslint-enable indent */
