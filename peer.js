'use strict';

const peer = {
  _status: 'DISCONNECTED', // CONNECTING, DISCONNECTED, CONNECTED
  get status() {
    return peer._status;
  },
  set status(val) {
    if (val !== peer._status) {
      peer._status = val;
      peer.emit('status', {
        newValue: val,
        oldValue: peer._status
      });
      peer.log('info', `peer status is changed to "${val}"`);
    }
  },
  _error: '',
  get error() {
    return peer._error;
  },
  set error(val) {
    if (val !== peer._error) {
      peer.emit('error', val);
      peer._error = val;
    }
  },
  timer: null,
  offline: false,
  events: {},
  reconnect: 0,
  log() {},
  emit(name, ...values) {
    (peer.events[name] || []).forEach(c => c(...values));
  },
  on(name, callback) {
    peer.events[name] = peer.events[name] || [];
    peer.events[name].push(callback);
  },
  socket() {
    peer.status = 'CONNECTING';
    window.clearTimeout(peer.timer);
    try {
      this.wss.close();
    }
    catch (e) {}

    const wss = this.wss = new WebSocket((peer.prefs.server).replace('[token]', peer.prefs.token));
    peer.log('info', 'try to create a new socket');
    wss.onopen = () => {
      peer.status = 'CONNECTED';
    };
    wss.onclose = () => {
      peer.status = 'DISCONNECTED';
    };
    wss.onmessage = e => {
      try {
        const request = JSON.parse(e.data);
        if (request.error) {
          peer.error = request.error;
          peer.shutdown();
        }
        peer.emit('message', request);
      }
      catch (e) {
        console.warn('Cannot Parse a peer message', e);
      }
    };
  },
  validate() {
    return peer.prefs.token && peer.offline === false && navigator.onLine && peer.status === 'DISCONNECTED';
  },
  connect(reason) {
    peer.log('info', `try to connect "${reason}"`);
    if (peer.validate()) {
      peer.socket();
    }
    else {
      peer.log('info', 'connection is ignored');
    }
  },
  disconnect() {
    this.wss.close();
    peer.status = 'DISCONNECTED';
  },
  send(o) {
    try {
      this.wss.send(JSON.stringify(o));
    }
    catch (e) {
      peer.log('error', e);
    }
  },
  shutdown() {
    peer.log('info', 'shutdown is request');
    peer.offline = true;
    peer.emit('shutdown');
    peer.disconnect();
  },
  restart() {
    peer.log('info', 'restart is request');
    peer.shutdown();
    window.clearTimeout(peer.timer);
    peer.timer = window.setTimeout(() => {
      peer.offline = false;
      peer.connect('restart');
    }, 1000);
  }
};
// reset next connection timeout
peer.on('status', ({newValue}) => {
  if (newValue === 'CONNECTED') {
    peer.reconnect = 0;
  }
});
// reconnect
peer.on('status', ({newValue}) => {
  if (newValue === 'DISCONNECTED') {
    const timeout = peer.prefs.reconnect[peer.reconnect];
    window.clearTimeout(peer.timer);
    peer.timer = window.setTimeout(() => {
      peer.connect(`Try to reconnect after "${timeout}" ms`);
    }, timeout);
    peer.reconnect = Math.min(peer.prefs.reconnect.length - 1, peer.reconnect + 1);
  }
});
window.addEventListener('online', () => {
  peer.connect('online');
});
window.addEventListener('offline', () => {
  peer.disconnect('offline');
});

// configs
peer.prefs = {
  token: '',
  channel: 1,
  server: 'wss://connect.websocket.in/v2/',
  reconnect: [1000, 2000, 5000, 10000, 40000]
};
