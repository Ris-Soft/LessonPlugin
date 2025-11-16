const config = {
  data: {},
  listeners: {},

  init() {
    try {
      const stored = localStorage.getItem('tme_config');
      if (stored) this.data = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  },

  setItem(key, value) {
    this.data[key] = value;
    this.save();
    if (this.listeners[key]) {
      this.listeners[key].forEach(fn => fn(value));
    }
  },

  getItem(key) {
    return this.data[key];
  },

  save() {
    try {
      localStorage.setItem('tme_config', JSON.stringify(this.data));
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  },

  listenChange(key, callback) {
    if (!this.listeners[key]) {
      this.listeners[key] = [];
    }
    this.listeners[key].push(callback);
  }
};

// 初始化默认配置
const defaultConfig = {
  'ext.playerPage.isEffect': true,
  'ext.playerPage.autoHideBottom': true,
  'ext.playerPage.lyricMode': false,
  'playerSetting_backgroundMode': "3",
  'playerSetting_blurEffect': 70,
  'playerSetting_darknessEffect': 0.6
};

// 初始化配置
config.init();
