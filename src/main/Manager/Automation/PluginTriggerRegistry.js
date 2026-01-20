function nowDate() { return new Date(); }

class PluginTriggerRegistry {
  constructor(store, logFn) {
    this.store = store;
    this.log = logFn || ((...a) => {});
    this.pluginTimers = new Map();
    this.pluginMinuteTriggers = new Map();
  }

  registerPluginTimers(pluginId, periods) {
    const canonId = String(pluginId || '').trim();
    if (!canonId) return { ok: false, error: 'invalid_plugin_id' };
    const list = Array.isArray(periods) ? periods.map((p, idx) => ({
      id: p?.id || `p_${idx}`,
      name: String(p?.name || `时段${idx + 1}`),
      enabled: p?.enabled !== false,
      start: String(p?.start || '').slice(0,5),
      end: String(p?.end || '').slice(0,5),
      weekdays: Array.isArray(p?.weekdays) ? p.weekdays : [1,2,3,4,5],
      biweek: ['even','odd','any'].includes(String(p?.biweek)) ? String(p.biweek) : 'any',
      speakStart: !!p?.speakStart,
      speakEnd: !!p?.speakEnd,
      soundIn: p?.soundIn !== false, 
      soundOut: p?.soundOut !== false, 
      actionsStart: Array.isArray(p?.actionsStart) ? p.actionsStart : [],
      actionsEnd: Array.isArray(p?.actionsEnd) ? p.actionsEnd : [],
      textStart: (p?.textStart || ''),
      textEnd: (p?.textEnd || ''),
      subTextEnd: (p?.subTextEnd ?? '')
    })) : [];
    this.pluginTimers.set(canonId, { periods: list });
    return { ok: true, count: list.length };
  }

  clearPluginTimers(pluginId) {
    const canonId = String(pluginId || '').trim();
    this.pluginTimers.delete(canonId);
    return { ok: true };
  }

  listPluginTimers(pluginId) {
    const canonId = String(pluginId || '').trim();
    const entry = this.pluginTimers.get(canonId) || { periods: [] };
    return { ok: true, periods: entry.periods };
  }

  registerPluginMinuteTriggers(pluginId, hhmmList, callback) {
    const canonId = String(pluginId || '').trim();
    if (!canonId) return { ok: false, error: 'invalid_plugin_id' };
    const times = Array.isArray(hhmmList) ? hhmmList.map((t) => String(t || '').slice(0,5)).filter((t) => /^(\d{2}:\d{2})$/.test(t)) : [];
    if (typeof callback !== 'function') return { ok: false, error: 'callback_required' };
    this.log('pluginMinute:register', canonId, times);
    this.pluginMinuteTriggers.set(canonId, { times: Array.from(new Set(times)), cb: callback });
    return { ok: true, count: times.length };
  }

  clearPluginMinuteTriggers(pluginId) {
    const canonId = String(pluginId || '').trim();
    this.pluginMinuteTriggers.delete(canonId);
    return { ok: true };
  }

  listPluginMinuteTriggers(pluginId) {
    const canonId = String(pluginId || '').trim();
    const entry = this.pluginMinuteTriggers.get(canonId) || { times: [], cb: null };
    return { ok: true, times: entry.times || [] };
  }

  checkTimers(curHHMM, dateObj) {
    const d = dateObj || nowDate();
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); 
    const base = this.store.get('system', 'semesterStart') || this.store.get('system', 'offsetBaseDate');
    const biweekOff = !!this.store.get('system', 'biweekOffset');
    let isEvenWeek = null;
    if (base) {
      try {
        const baseDate = new Date(base + 'T00:00:00');
        const diffDays = Math.floor((d - baseDate) / (24 * 3600 * 1000));
        const weekIndex = Math.floor(diffDays / 7);
        isEvenWeek = weekIndex % 2 === 0;
        if (biweekOff) isEvenWeek = !isEvenWeek;
      } catch (e) {}
    }

    const matchBiweek = (rule) => {
      if (rule === 'any' || rule == null) return true;
      if (isEvenWeek == null) return false;
      return rule === 'even' ? isEvenWeek : !isEvenWeek;
    };

    const tasks = [];
    for (const [pid, entry] of this.pluginTimers.entries()) {
      const periods = Array.isArray(entry?.periods) ? entry.periods : [];
      for (const p of periods) {
        if (!p.enabled) continue;
        const onWeekday = Array.isArray(p.weekdays) ? p.weekdays.includes(weekday) : true;
        if (!onWeekday || !matchBiweek(p.biweek)) continue;
        
        if (p.start && p.start === curHHMM) {
          if (p._lastStartMinute !== curHHMM) {
            p._lastStartMinute = curHHMM;
            this.log('period:start', pid, p.id, p.name);
            const acts = Array.isArray(p.actionsStart) ? p.actionsStart : [];
            if (acts.length) {
              tasks.push({ actions: acts, ctx: { reason: 'pluginTimer:start', pluginId: pid, now: d, period: p } });
            }
          }
        }
        
        if (p.end && p.end === curHHMM) {
          if (p._lastEndMinute !== curHHMM) {
            p._lastEndMinute = curHHMM;
            this.log('period:end', pid, p.id, p.name);
            const acts = Array.isArray(p.actionsEnd) ? p.actionsEnd : [];
            if (acts.length) {
              tasks.push({ actions: acts, ctx: { reason: 'pluginTimer:end', pluginId: pid, now: d, period: p } });
            }
          }
        }
      }
    }
    return tasks;
  }

  checkMinuteTriggers(curHHMM, dateObj) {
    const d = dateObj || nowDate();
    for (const [pid, entry] of this.pluginMinuteTriggers.entries()) {
      const times = Array.isArray(entry?.times) ? entry.times : [];
      const cb = entry?.cb;
      if (!times.length || typeof cb !== 'function') continue;
      if (times.includes(curHHMM)) {
        if (entry._lastMinute === curHHMM) continue;
        entry._lastMinute = curHHMM;
        this.log('pluginMinute:fire', pid, curHHMM);
        try { cb(curHHMM, d); } catch (e) {}
      }
    }
  }
}

module.exports = PluginTriggerRegistry;
