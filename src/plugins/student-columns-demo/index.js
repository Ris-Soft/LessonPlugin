module.exports = {
  name: 'student-columns-demo',
  // 可选：后端函数示例，便于测试插件调用
  backend: {
    ping: () => 'ok'
  },
  // 可选：自动化事件示例，便于在“自动执行”中查看
  automationEvents: [
    { id: 'demoEvent', name: '示例事件', desc: '用于测试的占位事件', params: [] }
  ]
};