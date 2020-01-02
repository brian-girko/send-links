/* global peer */
'use strict';

const notify = e => chrome.notifications.create({
  type: 'basic',
  iconUrl: '/data/icons/48.png',
  title: chrome.runtime.getManifest().name,
  message: e.message || e
});

const prefs = {
  name: '',
  id: '',
  server: 'wss://connect.websocket.in/v2/1?token=[token]',
  token: '',
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
    button.text('', 'Connected to the private network');
  }
  else if (o.newValue === 'DISCONNECTED') {
    button.text('D', 'Disconnected from the private network');
  }
  else if (o.newValue === 'CONNECTING') {
    button.text('...', 'Trying to join the private network');
  }
});
chrome.browserAction.onClicked.addListener(() => {
  if (prefs.token) {
    chrome.storage.local.set({
      enabled: prefs.enabled === false
    });
  }
  else {
    notify('For the extension to work, you need to get a free private TOKEN.');
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
      r('browser_action-' + id).then(() => chrome.runtime.lastError),
      r('link-' + id).then(() => chrome.runtime.lastError),
      r('selection-' + id).then(() => chrome.runtime.lastError)
    ]);
  },
  async init() {
    await menu.add({
      id: 'browser_action',
      enabled: false,
      title: 'Open Page Link in',
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
chrome.contextMenus.onClicked.addListener((info, tab) => {
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
      peer.send({
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
      });
    }
  }
});
{
  const update = () => {
    const count = Object.keys(cache).length;

    chrome.contextMenus.update('restart', {
      enabled: peer.status === 'CONNECTED'
    });
    chrome.contextMenus.update('browser_action', {
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
  console.log(request);
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
        id: 'browser_action-' + request.id,
        title: request.name,
        contexts: ['browser_action'],
        parentId: 'browser_action'
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
    if (request.context === 'browser_action') {
      chrome.tabs.create({
        url: request.page
      });
    }
    else if (request.context === 'link') {
      chrome.tabs.create({
        url: request.link
      });
    }
    else if (request.context === 'selection') {
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
  // peer
  peer.prefs.token = prefs.token;
  peer.prefs.server = prefs.server;
  peer.offline = prefs.enabled === false;
  // context menu
  await menu.init();
  // connection
  if (prefs.enabled) {
    console.log('stating...');
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
  if (ps.token) {
    peer.prefs.token = prefs.token;
    if (prefs.token) {
      peer.restart();
    }
    else {
      peer.disconnect();
    }
  }
  if (ps.server || ps.name) {
    peer.prefs.server = prefs.server;
    if (prefs.token) {
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
    chrome.contextMenus.update('browser_action', {
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
