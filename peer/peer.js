/* global safe */
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

    const wss = this.wss = new WebSocket((peer.prefs.server).replace('[apiKey]', peer.prefs.apiKey));
    peer.log('info', 'try to create a new socket');
    wss.onopen = () => {
      peer.status = 'CONNECTED';
    };
    wss.onclose = () => {
      peer.status = 'DISCONNECTED';
    };
    wss.onmessage = async e => {
      try {
        let data = e.data;
        if (peer.prefs.password && data.startsWith('data:application/octet-binary;base64,')) {
          data = await safe.decrypt(data);
        }
        const request = JSON.parse(data);
        if (request.error) {
          peer.error = request.error;
          peer.shutdown();
        }
        peer.emit('message', request);
      }
      catch (err) {
        console.warn('Cannot Parse a peer message', err, e);
      }
    };
  },
  validate() {
    return peer.prefs.apiKey && peer.offline === false && navigator.onLine && peer.status === 'DISCONNECTED';
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
    try {
      this.wss.close();
    }
    catch (e) {}
    peer.status = 'DISCONNECTED';
  },
  async send(o) {
    try {
      let msg = JSON.stringify(o);
      if (peer.prefs.password) {
        msg = await safe.encrypt(msg);
      }
      this.wss.send(msg);
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
  },
  async configure(ps) {
    peer.prefs = Object.assign(peer.prefs || {
      password: '', // if provided, all the data will be encrypted using this password
      apiKey: '',
      channel: 1,
      server: 'wss://connect.websocket.in/v3/',
      reconnect: [1000, 2000, 5000, 10000, 40000],
      iceServers: [{
        'url': 'stun:stun.services.mozilla.com'
      }],
      chunkSize: 1024 * 1,
      binaryTimeout: 30000
    }, ps);
    if (peer.prefs.password) {
      await safe.password(peer.prefs.password);
    }
  }
};
window.peer = peer;
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
// file transfer support
peer.binary = ({
  data,
  name,
  type
}, to, singnal = {
  on() {}
}, progress = () => {}) => new Promise((resolve, reject) => {
  const fileID = 'file:' + Math.random();
  try {
    const rtc = new RTCPeerConnection({
      iceServers: peer.prefs.iceServers
    });
    peer.binary.cache[fileID] = {rtc};
    const timer = {
      id: null,
      resume() {
        window.clearTimeout(timer.id);
        timer.id = window.setTimeout(() => {
          rtc.close();
          reject(Error('File Transfer Timeout'));
        }, peer.prefs.binaryTimeout);
      },
      abort() {
        window.clearTimeout(timer.id);
      }
    };
    timer.resume();
    const channel = rtc.createDataChannel('file-transfer');
    channel.binaryType = 'arraybuffer';
    let offset = 0;
    channel.onopen = channel.onmessage = () => {
      if (offset === 0) {
        channel.send(JSON.stringify({name, type}));
      }
      if (offset < data.byteLength) {
        timer.resume();
        const slice = data.slice(offset, offset + peer.prefs.chunkSize);
        channel.send(slice);
        offset += slice.byteLength;
        progress(offset / data.byteLength * 100);
      }
      else {
        timer.abort();
        resolve();
      }
    };
    channel.onclose = () => {
      peer.log('warn', 'rtc file transfer channel is closed');
      rtc.close();
      delete peer.binary.cache[fileID];
      reject(Error('File Transfer Failed'));
    };
    channel.onerror = reject;
    rtc.onicecandidate = e => e.candidate && peer.send({
      from: peer.id,
      to,
      fileID,
      method: 'rtc-candidate',
      candidate: e.candidate
    });
    singnal.on('abort', () => channel.close());
    rtc.createOffer().then(offer => {
      rtc.setLocalDescription(offer);
      peer.send({
        from: peer.id,
        to,
        fileID,
        method: 'rtc-offer',
        offer,
        size: data.byteLength
      });
    }).catch(reject);
  }
  catch (e) {
    console.error(e);
    reject(e);
  }
});
peer.binary.cache = {};
peer.on('message', async request => {
  if (request.method === 'rtc-offer' && peer.id === request.to) {
    const rtc = new RTCPeerConnection({
      iceServers: peer.prefs.iceServers
    });
    peer.binary.cache[request.fileID] = {rtc};
    rtc.onicecandidate = e => e.candidate && peer.send({
      from: peer.id,
      to: request.from,
      fileID: request.fileID,
      method: 'rtc-candidate',
      candidate: e.candidate
    });
    rtc.ondatachannel = e => {
      const channel = e.channel;
      channel.binaryType = 'arraybuffer';
      const chunks = [];
      const info = {};
      let size = 0;
      channel.onmessage = e => {
        if (e.data) {
          if (typeof e.data === 'string') {
            Object.assign(info, JSON.parse(e.data));
          }
          else {
            chunks.push(e.data);
            size += e.data.byteLength;
            channel.send(size);
            if (size === request.size) {
              channel.close();
              peer.emit('binary', {
                info,
                chunks
              });
            }
          }
        }
      };
      channel.onclose = () => {
        peer.log('warn', 'rtc file transfer  channel is closed');
        rtc.close();
        delete peer.binary.cache[request.fileID];
      };
    };
    rtc.onconnectionstatechange = () => {
      if (rtc.connectionState === 'failed') {
        rtc.close();
        delete peer.binary.cache[request.fileID];
      }
    };
    rtc.setRemoteDescription(request.offer);
    const answer = await rtc.createAnswer();
    rtc.setLocalDescription(answer);
    peer.send({
      from: peer.id,
      to: request.from,
      fileID: request.fileID,
      method: 'rtc-answer',
      answer
    });
  }
  else if (request.method === 'rtc-answer' && peer.id === request.to) {
    const o = peer.binary.cache[request.fileID];
    if (o) {
      o.rtc.setRemoteDescription(request.answer);
    }
  }
  else if (request.method === 'rtc-candidate' && peer.id === request.to) {
    const o = peer.binary.cache[request.fileID];
    if (o) {
      o.rtc.addIceCandidate(request.candidate);
    }
  }
});
