
function nowDate() { return new Date(); }

class ConditionEvaluator {
  constructor(store) {
    this.store = store;
  }

  evaluate(item) {
    const groups = Array.isArray(item?.conditions?.groups) ? item.conditions.groups : [];
    const topMode = item?.conditions?.mode === 'or' ? 'or' : 'and';
    const d = nowDate();
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 1..7（周一..周日）
    const month = d.getMonth() + 1; // 1..12
    const dom = d.getDate(); // 1..31
    // 读取单双周基准（来自 system.offsetBaseDate 或 system.semesterStart）
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

    const evalItem = (c) => {
      const negate = !!c.negate;
      let ok = true;
      switch (c.type) {
        case 'alwaysTrue': {
          ok = true;
          break;
        }
        case 'alwaysFalse': {
          ok = false;
          break;
        }
        case 'timeEquals': {
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          ok = `${hh}:${mm}` === String(c.value || '');
          break;
        }
        case 'weekdayIn': ok = Array.isArray(c.value) ? c.value.includes(weekday) : false; break;
        case 'monthIn': ok = Array.isArray(c.value) ? c.value.includes(month) : false; break;
        case 'dayIn': ok = Array.isArray(c.value) ? c.value.includes(dom) : false; break;
        case 'biweek': {
          if (isEvenWeek == null) ok = false; else ok = (c.value === 'even') ? isEvenWeek : !isEvenWeek;
          break;
        }
        case 'selectedWindowName': ok = false; break; // 预留：可通过 pluginManager 或主进程维护当前窗口状态
        case 'selectedProcess': ok = false; break; // 预留
        default: ok = true;
      }
      return negate ? !ok : ok;
    };

    const evalGroup = (g) => {
      const mode = g?.mode === 'or' ? 'or' : 'and';
      const items = Array.isArray(g?.items) ? g.items : [];
      if (!items.length) return true;
      if (mode === 'and') return items.every(evalItem);
      return items.some(evalItem);
    };

    if (!groups.length) return true;
    if (topMode === 'and') return groups.every(evalGroup);
    return groups.some(evalGroup);
  }
}

module.exports = ConditionEvaluator;
