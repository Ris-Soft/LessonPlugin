const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const ShortcutService = require('./ShortcutService');
const ActionExecutor = require('./ActionExecutor');
const ConditionEvaluator = require('./ConditionEvaluator');
const PluginTriggerRegistry = require('./PluginTriggerRegistry');
const ConfirmationService = require('./ConfirmationService');

function nowDate() { return new Date(); }

class AutomationManager {
  constructor({ app, store, pluginManager }) {
    this.app = app;
    this.store = store;
    this.pluginManager = pluginManager;
    // 初始化时从存储中读取列表（若不存在则为空数组）
    const initial = this.store.get('automation', 'list');
    this.items = Array.isArray(initial) ? initial : [];
    this.timer = null;
    
    // 轻日志：按系统配置或环境变量启用
    this.log = (...a) => { try { if (this.store.get('system','debugLog') || process.env.LP_DEBUG) console.log('[Automation]', ...a); } catch (e) {} };

    // Modules
    this.shortcutService = new ShortcutService(app);
    this.actionExecutor = new ActionExecutor(pluginManager, this.log);
    this.conditionEvaluator = new ConditionEvaluator(store);
    this.triggerRegistry = new PluginTriggerRegistry(store, this.log);
    this.confirmationService = new ConfirmationService();
  }

  init() {
    // 确保默认值
    this.store.ensureDefaults('automation', { list: [] });
    const latest = this.store.get('automation', 'list');
    this.items = Array.isArray(latest) ? latest : [];

    // 根据规范对齐分钟触发：插件 init 完成后按当前秒数决定补触发与定时器创建
    try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch (e) {}
    const align = () => {
      try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch (e) {}
      const d = nowDate();
      const sec = d.getSeconds();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const cur = `${hh}:${mm}`;
      const msToNextMinute = (60 - sec) * 1000;
      this.log('align:start', { cur, sec, msToNextMinute });
    
      const startAlignedInterval = () => {
        try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch (e) {}
        // 在 00 秒边界执行一次，然后进入每 60s 的对齐循环
        try { this.checkTimeTriggers(); this.log('aligned:boundary_tick'); } catch (e) {}
        this.timer = setInterval(() => { this.log('tick:minute'); try { this.checkTimeTriggers(); } catch (e) {} }, 60000);
      };
    
      // 启动时立即检查一次当前分钟（补触发），随后在下一分钟 00 秒对齐并进入每 60s 检查
      try { this.checkTimeTriggers(); this.log('startup:immediate_check', cur); } catch (e) {}
      this.log('align:schedule_next_minute', msToNextMinute);
      this.timer = setTimeout(startAlignedInterval, msToNextMinute);
    };
    align();

    // 系统睡眠后恢复：重新对齐
    try {
      const { powerMonitor } = require('electron');
      this._onResume = () => { align(); };
      powerMonitor.on('resume', this._onResume);
    } catch (e) {}
  }

  dispose() {
    try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch (e) {}
    try {
      const { powerMonitor } = require('electron');
      if (this._onResume) powerMonitor.removeListener('resume', this._onResume);
      this._onResume = null;
    } catch (e) {}
  }

  list() { return this.items; }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  create(payload) {
    const item = { id: uuidv4(), name: payload?.name || '未命名自动化', enabled: true, triggers: [], conditions: { mode: 'and', groups: [] }, actions: [], confirm: { enabled: true, timeout: 60 }, ...payload };
    this.items.push(item);
    this.store.set('automation', 'list', this.items);
    return item;
  }
  update(id, patch) {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false, error: 'not_found' };
    this.items[idx] = { ...this.items[idx], ...patch };
    this.store.set('automation', 'list', this.items);
    return { ok: true, item: this.items[idx] };
  }
  remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.store.set('automation', 'list', this.items);
    return { ok: true };
  }
  toggle(id, enabled) {
    const item = this.get(id); if (!item) return { ok: false, error: 'not_found' };
    item.enabled = !!enabled; this.store.set('automation', 'list', this.items); return { ok: true, item };
  }

  async test(id) {
    const item = this.get(id);
    if (!item) throw new Error('not_found');
    // 测试执行：忽略触发条件，仅按当前配置的执行条件与确认流程运行
    const canRun = this.conditionEvaluator.evaluate(item);
    if (!canRun) return { ok: true, executed: false, reason: 'conditions_not_met' };
    if (item?.confirm?.enabled) {
      const approved = await this.confirmationService.request(item, { reason: 'manual_test', itemId: item.id });
      if (approved) {
        await this.executeActions(item.actions || [], { reason: 'manual_test', itemId: item.id });
      }
      return { ok: true, executed: !!approved, reason: approved ? null : 'cancelled' };
    }
    await this.executeActions(item.actions || [], { reason: 'manual_test', itemId: item.id });
    return { ok: true, executed: true };
  }

  checkMinuteAlignmentStartup() {
    // deprecated: 启动对齐与补触发逻辑已迁移到 init()
  }

  checkTimeTriggers() {
    const d = nowDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const cur = `${hh}:${mm}`;
    for (const item of this.items) {
      if (!item.enabled) continue;
      const hit = (item.triggers || []).some((t) => t?.type === 'time' && t?.at === cur);
      // 避免同一分钟内重复触发（定时器每30秒检查一次，会命中两次）
      if (hit) {
        if (item._lastTimeMinute === cur) continue;
        item._lastTimeMinute = cur;
        this.tryExecute(item, { reason: 'time', now: d });
      }
    }

    // 检查插件计时器（开始/结束时间点）
    const tasks = this.triggerRegistry.checkTimers(cur, d);
    for (const task of tasks) {
      this.executeActions(task.actions, task.ctx);
    }
    
    // 新增：检查插件分钟触发器（HH:MM + 回调）
    this.triggerRegistry.checkMinuteTriggers(cur, d);
  }

  // 插件计时器接口：注册/清理/查询
  registerPluginTimers(pluginId, periods) { return this.triggerRegistry.registerPluginTimers(pluginId, periods); }
  clearPluginTimers(pluginId) { return this.triggerRegistry.clearPluginTimers(pluginId); }
  listPluginTimers(pluginId) { return this.triggerRegistry.listPluginTimers(pluginId); }

  // 为插件创建“动作快捷方式”到桌面：生成协议触发的自动化项 + .url 快捷方式 + ICO 图标
  async createActionShortcut(pluginId, options) {
    try {
      const nameRaw = String(options?.name || '').trim();
      const name = nameRaw || '插件动作';
      const actions = Array.isArray(options?.actions) ? options.actions : [];
      if (!actions.length) return { ok: false, error: 'actions_required' };
      
      // 1) 创建自动化项：使用协议触发（OrbiBoard://task/<text>）
      const protoText = `plugin:${String(pluginId || '').trim()}:${uuidv4().slice(0, 8)}`;
      const item = this.create({ name, source: 'shortcut', triggers: [{ type: 'protocol', text: protoText }], actions, confirm: { enabled: false, timeout: 0 } });

      return await this.shortcutService.createShortcut(item, protoText, options);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async invokeProtocol(text, params = {}) {
    for (const item of this.items) {
      if (!item.enabled) continue;
      const hit = (item.triggers || []).some((t) => t?.type === 'protocol' && String(t?.text || '').trim() === String(text || '').trim());
      if (hit) await this.tryExecute(item, { reason: 'protocol', text, params });
    }
    return { ok: true };
  }

  evaluateConditions(item) {
    return this.conditionEvaluator.evaluate(item);
  }

  async tryExecute(item, ctx) {
    if (!this.evaluateConditions(item)) return;
    if (item?.confirm?.enabled) {
      const approved = await this.confirmationService.request(item, { ...ctx, itemId: item.id });
      if (approved) {
        await this.executeActions(item.actions || [], { ...ctx, itemId: item.id });
      }
    } else {
      try { console.info('automation:execute', { id: item.id, name: item.name, reason: ctx?.reason || '' }); } catch (e) {}
      await this.executeActions(item.actions || [], { ...ctx, itemId: item.id });
    }
  }

  showConfirmOverlay(item, ctx) {
    // 兼容性保留
    return this.confirmationService.request(item, ctx);
  }

  async executeActions(actions, ctx) {
    await this.actionExecutor.execute(actions, ctx);
    // 记录上次成功执行时间
    try {
      const itemId = ctx?.itemId;
      if (itemId) {
        const item = this.get(itemId);
        if (item) {
          item.lastSuccessAt = nowDate().toISOString();
          this.store.set('automation', 'list', this.items);
        }
      }
    } catch (e) {}
  }

  // 新增：插件分钟触发器接口（仅 HH:MM 列表与回调）
  registerPluginMinuteTriggers(pluginId, hhmmList, callback) { return this.triggerRegistry.registerPluginMinuteTriggers(pluginId, hhmmList, callback); }
  clearPluginMinuteTriggers(pluginId) { return this.triggerRegistry.clearPluginMinuteTriggers(pluginId); }
  listPluginMinuteTriggers(pluginId) { return this.triggerRegistry.listPluginMinuteTriggers(pluginId); }
}

module.exports = AutomationManager;
