'use strict';

const toast = document.getElementById('toast');

chrome.storage.local.get({
  name: '',
  apiKey: '',
  server: 'wss://connect.websocket.in/v3/1?apiKey=[apiKey]',
  password: ''
}, prefs => {
  document.getElementById('name').value = prefs.name;
  document.getElementById('server').value = prefs.server;
  document.getElementById('apiKey').value = prefs.apiKey;
  document.getElementById('password').value = prefs.password;
});

document.querySelector('form').addEventListener('submit', e => {
  e.preventDefault();

  chrome.storage.local.set({
    name: document.getElementById('name').value,
    server: document.getElementById('server').value,
    apiKey: document.getElementById('apiKey').value,
    password: document.getElementById('password').value
  }, () => {
    toast.textContent = 'Options Saved';
    window.setTimeout(() => toast.textContent = '', 750);
  });
});
// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    toast.textContent = 'Double-click to reset!';
    window.setTimeout(() => toast.textContent = '', 750);
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});
// support
document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '?rd=donate'
}));
