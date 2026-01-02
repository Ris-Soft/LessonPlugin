function parse(url) {
  const raw = String(url || '');
  const mTask = raw.match(/^OrbiBoard:\/\/task\/([^?#]+)(?:\?([^#]+))?/i);
  const mStore = raw.match(/^OrbiBoard:\/\/market\/(install\/)?(plugin|component|automation)\/([^\/?#]+)(?:\?([^#]+))?/i);
  const mOpen = raw.match(/^OrbiBoard:\/\/open\/settings(?:\?([^#]+))?/i);
  const getParams = (qs) => {
    const obj = {};
    if (!qs) return obj;
    try {
      const sp = new URLSearchParams(qs);
      for (const [k, v] of sp.entries()) obj[k] = v;
    } catch (e) {}
    return obj;
  };
  if (mTask) {
    return { kind: 'task', taskText: decodeURIComponent(mTask[1]), params: getParams(mTask[2]) };
  }
  if (mStore) {
    return { kind: 'market', install: !!mStore[1], type: mStore[2], id: decodeURIComponent(mStore[3]), params: getParams(mStore[4]) };
  }
  if (mOpen) {
    return { kind: 'open', target: 'settings', params: getParams(mOpen[1]) };
  }
  return { kind: 'unknown' };
}

module.exports = { parse };
