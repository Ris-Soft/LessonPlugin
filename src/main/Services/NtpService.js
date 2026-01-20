const dgram = require('dgram');
const store = require('../Manager/Store/Main');

async function queryNtpTime(server, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const socket = dgram.createSocket('udp4');
      const packet = Buffer.alloc(48);
      packet[0] = 0x1B; // LI=0, VN=3, Mode=3 (client)
      let done = false;
      const finish = (value) => { if (!done) { done = true; try { socket.close(); } catch (_) {} resolve(value); } };
      const timer = setTimeout(() => finish(null), timeoutMs);
      socket.once('error', () => { clearTimeout(timer); finish(null); });
      socket.on('message', (msg) => {
        clearTimeout(timer);
        try {
          const secs = msg.readUInt32BE(40);
          const frac = msg.readUInt32BE(44);
          const NTP_UNIX_OFFSET = 2208988800; // seconds between 1900-01-01 and 1970-01-01
          const unixSecs = secs - NTP_UNIX_OFFSET;
          const ms = unixSecs * 1000 + Math.floor(frac * 1000 / 0x100000000);
          finish(ms);
        } catch (e) {
          finish(null);
        }
      });
      socket.send(packet, 0, packet.length, 123, server, (err) => {
        if (err) { clearTimeout(timer); finish(null); }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

async function getTime() {
  const cfg = store.getAll('system') || {};
  let baseMs = Date.now();
  if (cfg.preciseTimeEnabled) {
    const server = String(cfg.ntpServer || 'ntp.aliyun.com').trim();
    const ntpMs = await queryNtpTime(server).catch(() => null);
    if (typeof ntpMs === 'number' && Number.isFinite(ntpMs)) baseMs = ntpMs;
  }
  // 计算天数差
  const baseDateStr = cfg.semesterStart || cfg.offsetBaseDate || new Date().toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  // 将日期转为UTC日开始，计算差值
  const baseMsDay = Date.parse(baseDateStr + 'T00:00:00Z');
  const todayMsDay = Date.parse(todayStr + 'T00:00:00Z');
  const days = Math.max(0, Math.floor((todayMsDay - baseMsDay) / (24 * 3600 * 1000)));
  const effectiveOffsetSec = Number(cfg.timeOffset || 0) + days * Number(cfg.autoOffsetDaily || 0);
  const adjMs = baseMs + effectiveOffsetSec * 1000;
  return { nowMs: adjMs, iso: new Date(adjMs).toISOString(), offsetSec: effectiveOffsetSec, daysFromBase: days };
}

module.exports = {
  queryNtpTime,
  getTime
};
