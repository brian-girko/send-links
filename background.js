/* global peer */
'use strict';

const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});
window.notify = notify;

const prefs = {
  name: '',
  id: '',
  server: 'wss://connect.websocket.in/v3/1?apiKey=[apiKey]',
  apiKey: '',
  password: '',
  enabled: true,
  contexts: ['browser_action', 'link', 'selection']
};
const cache = {}; // ids of connected peers

/* browser action */
const button = {
  text(badge, tooltip) {
    chrome.browserAction.setBadgeText({
      text: badge
    });
    chrome.browserAction.setTitle({
      title: tooltip
    });
  }
};
peer.on('status', o => {
  if (o.newValue === 'CONNECTED') {
    button.text('', 'Connected to the private network' + '\n\n' + 'Computer Name: ' + prefs.name);
  }
  else if (o.newValue === 'DISCONNECTED') {
    button.text('D', 'Disconnected from the private network');
  }
  else if (o.newValue === 'CONNECTING') {
    button.text('...', 'Trying to join the private network');
  }
});
chrome.browserAction.onClicked.addListener(() => {
  if (prefs.apiKey) {
    chrome.storage.local.set({
      enabled: prefs.enabled === false
    });
  }
  else {
    notify('For the extension to work, you need to get a free private API KEY.');
    chrome.runtime.openOptionsPage();
  }
});
chrome.browserAction.setBadgeBackgroundColor({
  color: '#a29588'
});

const menu = {
  add(o) {
    return new Promise(resolve => chrome.contextMenus.create(o, resolve));
  },
  remove(id) {
    const r = id => new Promise(resolve => chrome.contextMenus.remove(id, resolve));
    return Promise.all([
      r('browser_action_page-' + id).then(() => chrome.runtime.lastError),
      r('browser_action_clipboard-' + id).then(() => chrome.runtime.lastError),
      r('browser_action_file-' + id).then(() => chrome.runtime.lastError),
      r('link-' + id).then(() => chrome.runtime.lastError),
      r('selection-' + id).then(() => chrome.runtime.lastError)
    ]);
  },
  async init() {
    await menu.add({
      id: 'browser_action_page',
      enabled: false,
      title: 'Open Page Link in',
      contexts: ['browser_action'],
      visible: prefs.contexts.indexOf('browser_action') !== -1
    });
    await menu.add({
      id: 'browser_action_clipboard',
      enabled: false,
      title: 'Send Clipboard Content to',
      contexts: ['browser_action'],
      visible: prefs.contexts.indexOf('browser_action') !== -1
    });
    await menu.add({
      id: 'browser_action_file',
      enabled: false,
      title: 'Send a File to',
      contexts: ['browser_action'],
      visible: prefs.contexts.indexOf('browser_action') !== -1
    });
    await menu.add({
      type: 'separator',
      id: 'separator',
      title: 'Separator',
      contexts: ['browser_action'],
      visible: prefs.contexts.indexOf('browser_action') !== -1
    });
    await menu.add({
      id: 'link',
      enabled: false,
      title: 'Open Link in',
      contexts: ['link'],
      visible: prefs.contexts.indexOf('link') !== -1
    });
    await menu.add({
      id: 'selection',
      enabled: false,
      title: 'Copy to Clipboard of',
      contexts: ['selection'],
      visible: prefs.contexts.indexOf('selection') !== -1
    });
    await menu.add({
      id: 'restart',
      enabled: false,
      title: 'Restart Network',
      contexts: ['browser_action']
    });
    await menu.add({
      id: 'power',
      title: 'Join Network',
      contexts: ['browser_action']
    });
  }
};
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'power') {
    chrome.storage.local.set({
      enabled: prefs.enabled === false
    });
  }
  else if (info.menuItemId === 'restart') {
    peer.restart();
  }
  else {
    const [context, id] = info.menuItemId.split('-');
    if (id && context) {
      const o = {
        method: 'remote-action',
        id,
        context,
        page: tab.url,
        link: info.linkUrl,
        selectionText: info.selectionText,
        sender: {
          id: prefs.id,
          name: prefs.name
        }
      };
      try {
        if (context === 'browser_action_file') {
          chrome.storage.local.get({
            width: 500,
            height: 120,
            left: screen.availLeft + Math.round((screen.availWidth - 500) / 2),
            top: screen.availTop + Math.round((screen.availHeight - 120) / 2)
          }, prefs => {
            chrome.windows.create({
              url: chrome.extension.getURL('data/file/index.html') + '?id=' + id,
              width: prefs.width,
              height: prefs.height,
              left: prefs.left,
              top: prefs.top,
              type: 'popup'
            });
          });
        }
        else {
          if (context === 'browser_action_clipboard') {
            try {
              o.selectionText = await navigator.clipboard.readText();
            }
            catch (e) {
              o.selectionText = await new Promise((resolve, reject) => {
                const input = document.createElement('input');
                document.body.appendChild(input);
                input.focus();
                document.execCommand('paste');
                if (input.value) {
                  resolve(input.value);
                }
                else {
                  reject(Error('Cannot read clipboard content or it is empty!'));
                }
                document.body.removeChild(input);
              });
            }
          }
          peer.send(o);
        }
      }
      catch (e) {
        notify('Cannot Complete user-action: ' + e.message);
      }
    }
  }
});
{
  const update = () => {
    const count = Object.keys(cache).length;

    chrome.contextMenus.update('restart', {
      enabled: peer.status === 'CONNECTED'
    });
    chrome.contextMenus.update('browser_action_page', {
      enabled: peer.status === 'CONNECTED' && count !== 0
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.update('browser_action_clipboard', {
      enabled: peer.status === 'CONNECTED' && count !== 0
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.update('browser_action_file', {
      enabled: peer.status === 'CONNECTED' && count !== 0
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.update('link', {
      enabled: peer.status === 'CONNECTED' && count !== 0
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.update('selection', {
      enabled: peer.status === 'CONNECTED' && count !== 0
    }, () => chrome.runtime.lastError);

    chrome.contextMenus.update('power', {
      enabled: peer.status !== 'connecting'
    });
    if (peer.status === 'CONNECTED' || peer.status === 'DISCONNECTED') {
      chrome.contextMenus.update('power', {
        title: peer.status === 'CONNECTED' ? 'Disconnect Network' : 'Join Network'
      });
    }
  };
  peer.on('status', update);
  peer.on('fake-status', update);
}

peer.on('message', request => {
  if (request.method === 'whoami') {
    peer.send({
      method: 'peer',
      id: prefs.id,
      name: prefs.name
    });
  }
  //
  if (request.method === 'whoami' || request.method === 'peer') {
    cache[request.id] = true;
    peer.emit('fake-status');
    menu.remove(request.id).then(() => {
      menu.add({
        id: 'browser_action_page-' + request.id,
        title: request.name,
        contexts: ['browser_action'],
        parentId: 'browser_action_page'
      });
      menu.add({
        id: 'browser_action_clipboard-' + request.id,
        title: request.name,
        contexts: ['browser_action'],
        parentId: 'browser_action_clipboard'
      });
      menu.add({
        id: 'browser_action_file-' + request.id,
        title: request.name,
        contexts: ['browser_action'],
        parentId: 'browser_action_file'
      });
      menu.add({
        id: 'link-' + request.id,
        title: request.name,
        contexts: ['link'],
        parentId: 'link'
      });
      menu.add({
        id: 'selection-' + request.id,
        title: request.name,
        contexts: ['selection'],
        parentId: 'selection'
      });
    });
  }
  else if (request.method === 'shutdown') {
    delete cache[request.id];
    peer.emit('fake-status');
    menu.remove(request.id);
  }
  else if (request.method === 'remote-action' && request.id === prefs.id) {
    if (request.context === 'browser_action_page') {
      chrome.tabs.create({
        url: request.page
      });
    }
    else if (request.context === 'link') {
      chrome.tabs.create({
        url: request.link
      });
    }
    else if (request.context === 'selection' || request.context == 'browser_action_clipboard') {
      navigator.clipboard.writeText(request.selectionText).catch(() => new Promise(resolve => {
        document.oncopy = e => {
          e.clipboardData.setData('text/plain', request.selectionText);
          e.preventDefault();
          resolve();
        };
        document.execCommand('Copy', false, null);
      })).then(() => notify(`Clipboard content is updated by "${request.sender.name}"`));
    }
  }
});
peer.on('shutdown', () => peer.send({
  method: 'shutdown',
  id: prefs.id
}));
peer.on('status', o => o.newValue === 'CONNECTED' && peer.send({
  method: 'whoami',
  id: prefs.id,
  name: prefs.name
}));
peer.on('error', notify);
peer.on('binary', e => {
  const blob = new Blob(e.chunks, {
    type: e.info.type
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = e.info.name;
  a.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 30000);
});

button.text('D', chrome.runtime.getManifest().name);
chrome.storage.local.get(prefs, async ps => {
  // assign a new id
  if (ps.id === '') {
    prefs.id = 'machine:' + Math.random();
    chrome.storage.local.set({
      id: prefs.id
    });
  }
  if (ps.name === '') {
    prefs.name = 'My Browser - ' + Math.random().toString(36).substring(7);
    chrome.storage.local.set({
      name: prefs.name
    });
  }
  // prefs
  Object.assign(prefs, ps);
  // peer.id is required for file transfer
  peer.id = prefs.id;
  // peer
  peer.offline = prefs.enabled === false;
  await peer.configure({
    apiKey: prefs.apiKey,
    server: prefs.server,
    password: prefs.password
  });
  // context menu
  await menu.init();
  // connection
  if (prefs.enabled) {
    peer.connect('init');
  }
});
chrome.storage.onChanged.addListener(ps => {
  Object.entries(ps).forEach(([name, v]) => prefs[name] = v.newValue);
  if (ps.enabled && prefs.enabled) {
    peer.offline = false;
    peer.connect('enabled');
  }
  if (ps.enabled && !prefs.enabled) {
    peer.shutdown();
  }
  if (ps.apiKey || ps.server || ps.name || ps.password) {
    if (ps.apiKey) {
      peer.configure({
        apiKey: prefs.apiKey
      });
    }
    if (ps.server) {
      peer.configure({
        server: prefs.server
      });
    }
    if (ps.password) {
      peer.configure({
        password: prefs.password
      });
    }
    //
    if (prefs.apiKey && prefs.enabled) {
      peer.restart();
    }
    else {
      peer.disconnect();
    }
  }
  if (ps.contexts) {
    chrome.contextMenus.update('link', {
      visible: ps.contexts.indexOf('link') !== -1
    });
    chrome.contextMenus.update('browser_action_page', {
      visible: ps.contexts.indexOf('browser_action') !== -1
    });
    chrome.contextMenus.update('browser_action_clipboard', {
      visible: ps.contexts.indexOf('browser_action') !== -1
    });
    chrome.contextMenus.update('browser_action_file', {
      visible: ps.contexts.indexOf('browser_action') !== -1
    });
    chrome.contextMenus.update('separator', {
      visible: ps.contexts.indexOf('browser_action') !== -1
    });
    chrome.contextMenus.update('selection', {
      visible: ps.contexts.indexOf('selection') !== -1
    });
  }
});
//
chrome.runtime.onMessage.addListener(request => {
  console.log(request);
});

// FAQs and Feedback
{
  const {onInstalled, setUninstallURL, getManifest} = chrome.runtime;
  const {name, version} = getManifest();
  const page = getManifest().homepage_url;
  onInstalled.addListener(({reason, previousVersion}) => {
    chrome.storage.local.get({
      'faqs': true,
      'last-update': 0
    }, prefs => {
      if (reason === 'install' || (prefs.faqs && reason === 'update')) {
        const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
        if (doUpdate && previousVersion !== version) {
          chrome.tabs.create({
            url: page + '?version=' + version +
              (previousVersion ? '&p=' + previousVersion : '') +
              '&type=' + reason,
            active: reason === 'install'
          });
          chrome.storage.local.set({'last-update': Date.now()});
        }
      }
    });
  });
  setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
}
