'use strict';
const args = new URLSearchParams(location.search);

const input = document.getElementById('file');

function humanFileSize(bytes, si) {
  const thresh = si ? 1000 : 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }
  const units = si ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  do {
    bytes /= thresh;
    ++u;
  }
  while (Math.abs(bytes) >= thresh && u < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[u];
}

chrome.runtime.getBackgroundPage(bg => {
  input.onchange = () => {
    input.disabled = true;
    input.style.display = 'none';
    document.title = 'Please wait ...';
    const file = input.files[0];
    document.getElementById('name').textContent = file.name;
    document.getElementById('size').textContent = humanFileSize(file.size);
    const reader = new FileReader();
    reader.onerror = e => bg.notify(e.message || 'File Read Error');
    reader.onload = () => bg.peer.binary({
      data: reader.result,
      name: file.name,
      type: file.type
    }, args.get('id'), {
      on(name, callback) {
        if (name === 'abort') {
          window.onbeforeunload = callback;
        }
      }
    }, value => {
      document.title = value.toFixed(0) + '%';
      document.getElementById('progress').value = value;
    })
      .then(() => document.title = 'File Transfer Completed')
      .catch(e => {
        const msg = e.message || 'File Transfer Error';
        bg.notify(msg);
        document.title = 'Error: ' + msg;
        console.error(e);
      });
    reader.readAsArrayBuffer(file);
  };
});
